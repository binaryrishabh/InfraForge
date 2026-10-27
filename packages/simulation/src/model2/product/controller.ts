import { requireKnown } from "../../reality/quantity";
import type { CompiledPool } from "./contracts";
import type { EventKernel } from "../time";
import type { NetworkContext } from "../network/run";
import type { SystemsExtension } from "../systems/run";
import { recommendReplicas } from "./controller-policy";
type Controls = Parameters<SystemsExtension["install"]>[2];
type ReplicaState = "reserved" | "provisioning" | "pulling" | "starting" | "ready" | "draining" | "failed" | "terminated";
interface Counters { at: number; used: number; available: number; since?: { at: number; used: number; available: number } }
export function replicaController(pool: CompiledPool, kernel: EventKernel, context: NetworkContext, controls: Controls, horizon: number) {
  const p = pool.profile, n = <U extends "us" | "count" | "ratio">(q: Parameters<typeof requireKnown<U>>[0], u: U) => requireKnown(q, u);
  const replicas = pool.replicas.map((id, ordinal) => ({ id, ordinal, state: "reserved" as ReplicaState, createdAt: null as number | null, readyAt: null as number | null, attempts: 0, stopped: false, drainAt: null as number | null }));
  let desired = n(p.initial, "count"), lastChange = -Infinity, sequence = 0, evaluations = 0, missing = 0, budgetExhausted = 0, omitted = 0;
  const events: Array<{ at: number; kind: string; id: string; detail: string }> = [], recommendations: Array<{ at: number; value: number }> = [], previous = new Map<string, Counters>(); let recommendationHead = 0;
  const event = (kind: string, id: string, detail: string) => { if (events.length < 10000) events.push({ at: kernel.now, kind, id, detail }); else omitted++; };
  const schedule = (delay: number, id: string, run: () => void) => { const at = kernel.now + delay; if (at <= horizon) kernel.schedule(at, 4, JSON.stringify(["controller", pool.id, id, sequence++]), run); };
  const terminate = (r: typeof replicas[number]) => { if (r.state === "terminated") return; r.stopped = true; context.setReady(r.id, false); context.setAvailable(r.id, false); context.abortOwned(r.id); context.retireOwner?.(r.id); r.state = "terminated"; event("terminated", r.id, "routing stopped; work drained or explicit grace elapsed; owned compute calls aborted and memory released"); };
  const acquire = (r: typeof replicas[number]) => {
    if (r.stopped) return; r.attempts++; r.state = "pulling"; event("artifact-start", r.id, `attempt ${r.attempts}`);
    const a = pool.artifactClients.find((a) => a.replica === r.id)!;
    controls.artifacts(a.id, r.id, (ok) => {
      if (r.stopped) return;
      if (!ok) { r.state = "failed"; event("artifact-failed", r.id, "actual registry/manifest/blob acquisition failed"); if (r.attempts < n(p.attempts, "count")) schedule(n(p.retry, "us"), r.id, () => acquire(r)); return; }
      r.state = "starting"; event("artifacts-acquired", r.id, "M2G client owns all manifest layers; authored process-start work remains");
      schedule(n(p.startup, "us"), r.id, () => { if (r.stopped) return; context.setAvailable(r.id, true); context.setReady(r.id, true); r.state = "ready"; r.readyAt = kernel.now; event("readiness", r.id, "artifacts and authored startup complete; listener gate open; LB still requires its own health observations"); });
    });
  };
  const create = (r: typeof replicas[number]) => {
    r.state = "provisioning"; r.createdAt = kernel.now; event("replica-created", r.id, "desired capacity created a distinct identity, not serving capacity");
    schedule(n(p.provision, "us"), r.id, () => { if (r.stopped) return; if (p.provisionFailures.includes(r.ordinal)) { r.state = "failed"; r.attempts = n(p.attempts, "count"); event("provision-failed", r.id, "authored generic provider failure; no readiness"); return; } acquire(r); });
  };
  const reconcile = () => {
    const owned = replicas.filter((r) => !["reserved", "terminated", "draining"].includes(r.state));
    if (owned.length < desired) {
      let needed = desired - owned.length;
      for (const r of replicas) if (needed && r.state === "reserved") { create(r); needed--; }
      if (needed) { budgetExhausted++; event("identity-budget", pool.id, "finite creation slots exhausted; desired stays distinct from actual"); }
    }
    if (owned.length > desired) for (const r of owned.sort((a, b) => b.ordinal - a.ordinal).slice(0, owned.length - desired)) {
      r.stopped = true; r.drainAt = kernel.now; r.state = "draining";
      context.setReady(r.id, false); context.drain(p.loadBalancer, r.id, n(p.drain, "us")); event("draining", r.id, "stop new LB routing before existing work settles");
      const check = () => { const s = context.observe(r.id) as { queued: number; serving: number; waiting: number }; if ((context.backend(p.loadBalancer, r.id).outstanding === 0 && s.queued + s.serving + s.waiting === 0) || kernel.now >= r.drainAt! + n(p.drain, "us")) terminate(r); else schedule(Math.min(n(p.interval, "us"), r.drainAt! + n(p.drain, "us") - kernel.now), r.id, check); }; schedule(0, r.id, check);
    }
  };
  const direct = (id: string): Counters => { const station = context.observe(id) as { compute?: { cpu: { appCoreUs: number; competitorCoreUs: number; availableCoreUs: number } } }; const cpu = station.compute?.cpu; if (!cpu) throw Error("Controller direct signal requires actual M2C CPU evidence"); return { at: kernel.now, used: cpu.appCoreUs + cpu.competitorCoreUs, available: cpu.availableCoreUs }; };
  const observed = (id: string): Counters | undefined => {
    if (p.signal.kind !== "observed-core-time") return;
    const rows = controls.samples(p.signal.backend, id).filter((s) => kernel.now - s.measurementAt <= n(p.signal.kind === "observed-core-time" ? p.signal.freshFor : p.interval, "us")).sort((a, b) => b.measurementAt - a.measurementAt);
    const latest = rows[0], prior = rows[1]; if (!latest || !prior || prior.measurementAt >= latest.measurementAt) return;
    const values = latest.values as { consumedCoreUs?: number; availableCoreUs?: number; totalCoreUs?: number };
    const before = prior.values as { availableCoreUs?: number; totalCoreUs?: number };
    if (typeof values.availableCoreUs !== "number" || typeof values.totalCoreUs !== "number" || typeof before.availableCoreUs !== "number" || typeof before.totalCoreUs !== "number") return;
    return { at: latest.measurementAt, used: values.totalCoreUs, available: values.availableCoreUs, since: { at: prior.measurementAt, used: before.totalCoreUs, available: before.availableCoreUs } };
  };
  const tick = () => {
    evaluations++; let used = 0, available = 0, valid = true;
    const ready = replicas.filter((r) => r.state === "ready" && context.endpoint(r.id).alive && context.endpoint(r.id).ready && context.backend(p.loadBalancer, r.id).health);
    const readyIds = new Set(ready.map((r) => r.id));
    for (const r of replicas) {
      const sample = p.signal.kind === "direct-core-time" ? direct(r.id) : observed(r.id), last = previous.get(r.id), old = sample?.since ?? last;
      if (sample) previous.set(r.id, sample); else previous.delete(r.id);
      if (!readyIds.has(r.id)) continue;
      if (!sample || !old || old.at < r.readyAt! || sample.at <= old.at || sample.available <= old.available || sample.used < old.used || (p.signal.kind === "observed-core-time" && (sample.at === last?.at || sample.at - old.at > n(p.signal.freshFor, "us")))) { valid = false; continue; }
      used += sample.used - old.used; available += sample.available - old.available;
    }
    if (!ready.length || !valid || available <= 0) { missing++; event("signal-missing", pool.id, "hold desired; no current complete interval from the selected evidence owner"); }
    else {
      const utilization = used / available, raw = recommendReplicas(ready.length, utilization, n(p.target, "ratio"), n(p.tolerance, "ratio"), n(p.min, "count"), n(p.max, "count"));
      while (recommendations.length > recommendationHead && recommendations.at(-1)!.value <= raw) recommendations.pop();
      recommendations.push({ at: kernel.now, value: raw });
      while (recommendationHead < recommendations.length && recommendations[recommendationHead]!.at < kernel.now - n(p.downStabilization, "us")) recommendationHead++;
      if (recommendationHead > 1024 && recommendationHead * 2 > recommendations.length) { recommendations.splice(0, recommendationHead); recommendationHead = 0; }
      const recommendation = raw < desired ? Math.max(raw, recommendations[recommendationHead]?.value ?? raw) : raw;
      const pending = replicas.some((r) => ["provisioning", "pulling", "starting", "failed"].includes(r.state));
      event("evaluation", pool.id, JSON.stringify({ source: p.signal.kind, usedCoreUs: used, availableCoreUs: available, utilization, ready: ready.length, recommendation, desired }));
      if (kernel.now - lastChange >= n(p.cooldown, "us") && recommendation !== desired && !(pending && recommendation < desired)) { desired = recommendation; lastChange = kernel.now; event("desired", pool.id, String(desired)); }
    }
    reconcile(); schedule(n(p.interval, "us"), "evaluate", tick);
  };
  for (const r of replicas) {
    const ready = p.initialReady === true && r.ordinal < desired;
    context.setReady(r.id, ready); context.setAvailable(r.id, ready);
    if (ready) {
      r.state = "ready"; r.createdAt = 0; r.readyAt = 0;
      if (p.signal.kind === "direct-core-time") previous.set(r.id, direct(r.id));
      event("initial-ready", r.id, "explicitly authored already deployed replica; future replicas still acquire artifacts and start");
    }
  }
  for (const m of p.manual) kernel.schedule(n(m.at, "us"), 0, JSON.stringify(["manual-desired", pool.id, m.id]), () => { desired = n(m.desired, "count"); lastChange = kernel.now; event("manual-desired", pool.id, String(desired)); reconcile(); });
  schedule(0, "initial", reconcile); schedule(n(p.interval, "us"), "evaluate", tick);
  return {
    // Current replica counts only, for once-per-second live reads (evidence() also copies history).
    status: () => ({ id: pool.id, desired, ready: replicas.filter((r) => r.state === "ready").length, total: replicas.filter((r) => r.state !== "reserved" && r.state !== "terminated").length }),
    evidence: () => ({ id: pool.id, profile: p.schema, metricSource: p.signal.kind, desired, evaluations, missingMeasurements: missing, identityBudgetExhausted: budgetExhausted, populations: Object.fromEntries((["reserved", "provisioning", "pulling", "starting", "ready", "draining", "failed", "terminated"] as ReplicaState[]).map((state) => [state, replicas.filter((r) => r.state === state).length])), inService: replicas.filter((r) => r.state === "ready" && context.endpoint(r.id).alive && context.endpoint(r.id).ready && context.backend(p.loadBalancer, r.id).health).length, replicas: replicas.map((r) => ({ ...r, endpoint: context.endpoint(r.id), lb: context.backend(p.loadBalancer, r.id) })), events: [...events], omitted }) };
}
