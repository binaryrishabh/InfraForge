import { createProductModel2 } from "./run";
import { compileProduct } from "./compiler";
import { withTimeline, type TimedAction } from "./timeline";
import type { CompiledProduct, ProductContract, SavedProductDesign } from "./contracts";
import type { CausalObserver } from "../workload/causal";

// One simulated second at a time, projected onto the canvas nodes the person drew.
// Values Model 2 does not know stay null ("Unknown"); they are never shown as zero.
export type LiveValue = number | null;
export type LiveHealth = "healthy" | "degraded" | "saturated" | "failed" | "unknown";
export interface LiveNodeMetrics {
  asyncQueue?: import("@infraforge/contracts/telemetry").AsyncQueueMetrics;
  cpu: LiveValue; memory: LiveValue; connections: LiveValue; rps: LiveValue; errorRate: LiveValue; health: LiveHealth;
  replicas?: { ready: number; total: number };
}
export interface LiveProjection {
  simulatedSeconds: number;
  offeredRps: number; completedRps: number; failedRps: number;
  // Caller response times of requests that completed during this second; null when none completed.
  latencyMs: { p50: LiveValue; p95: LiveValue };
  metrics: Record<string, LiveNodeMetrics>;
  overallHealth: "healthy" | "degraded" | "saturated" | "critical";
}

type Counters = { received: number; completed: number; failed: number; queued: number; serving: number; used: number; available: number | null; consumed: number };
type Station = { received: number; completed: number; failed: number; rejected: number; queued: number; serving: number; consumedCoreUs: number;
  compute?: { cpu?: { appCoreUs: number; competitorCoreUs: number; availableCoreUs: number } } };
type Balancer = { received: number; completed: number; rejected: number; active: number; pending: number; backends: Array<{ health: boolean; draining: boolean }> };

const SECOND = 1_000_000;
const ratio = (part: number, whole: number) => whole > 0 ? part / whole : null;
const percentile = (sorted: number[], p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]! / 1000 : null;

export function createLiveModel2(compiled: CompiledProduct, nodeIds: string[]) {
  // Caller outcomes are counted as they happen, so a second's totals never need the run's history.
  const caller = { offered: 0, completed: 0, failed: 0 };
  let responses: number[] = [];
  const observe: CausalObserver = (event) => {
    if (event.kind === "caller-offered") caller.offered++;
    else if (event.kind === "caller-terminal") {
      if (event.detail.outcome === "completed") { caller.completed++; responses.push(event.detail.responseUs as number); } else caller.failed++;
    }
  };
  const runtime = createProductModel2(compiled, undefined, observe);
  // A node owns its own resource and every replica or helper named after it (vm#0, vm#0/aside).
  const owner = (resourceId: string) => nodeIds.find((n) => resourceId === n || resourceId.startsWith(`${n}#`) || resourceId.startsWith(`${n}/`));
  const resources = (compiled.input.resources as Array<{ id: string; kind?: string; cores?: { kind: string; value?: number }; execution?: { cores?: { kind: string; value?: number } } }>);
  // A cache refuses stale cache-aside fills by design; callers fall back, so only its rejections count as errors.
  const caches = new Set(resources.filter((r) => r.kind === "cache").map((r) => r.id));
  // Authored cores per runtime resource, for resources whose CPU is reported as consumed core-time only.
  const cores = new Map<string, number>();
  for (const r of resources) {
    const q = r.cores ?? r.execution?.cores;
    if (q?.kind === "known" && typeof q.value === "number") cores.set(r.id, q.value);
  }
  const members = new Map(nodeIds.map((n) => [n, resources.map((r) => r.id).filter((id) => owner(id) === n)]));
  let now = 0, previousAt = 0;
  const previous = new Map<string, Counters>();
  let previousLb = new Map<string, { received: number; completed: number; rejected: number }>();
  let previousCaller = { ...caller };

  return {
    get simulatedSeconds() { return now / SECOND; },
    get horizon() { return runtime.horizon; },
    evidence: runtime.evidence,
    applicationFlowEvidence: runtime.applicationFlowEvidence,
    advanceSecond() {
      if (now + SECOND > runtime.horizon) throw new Error("The run has reached its simulated horizon");
      now += SECOND; runtime.advanceTo(now);
    },
    // Moves toward a whole second without reporting the seconds in between, at most `step` seconds per call.
    // Returns true once there; the next project() then covers only the second after it.
    catchUp(seconds: number, step: number) {
      if (!Number.isSafeInteger(seconds) || seconds * SECOND < now || seconds * SECOND > runtime.horizon) throw new Error("Invalid catch-up target");
      now = Math.min(seconds * SECOND, now + step * SECOND); runtime.advanceTo(now);
      if (now < seconds * SECOND) return false;
      this.project(); return true;
    },
    project(): LiveProjection {
      const ready = new Map<string, { ready: number; total: number }>();
      for (const pool of runtime.pools()) ready.set(owner(pool.id) ?? pool.id, { ready: pool.ready, total: pool.total });
      const metrics: Record<string, LiveNodeMetrics> = {};
      const lbNow = new Map<string, { received: number; completed: number; rejected: number }>();
      for (const node of nodeIds) {
        const own = runtime.inspect(node) as Partial<Balancer> | undefined;
        if (own && Array.isArray(own.backends)) {
          const lb = own as Balancer, before = previousLb.get(node) ?? { received: 0, completed: 0, rejected: 0 };
          lbNow.set(node, { received: lb.received, completed: lb.completed, rejected: lb.rejected });
          const received = lb.received - before.received, completed = lb.completed - before.completed, rejected = lb.rejected - before.rejected;
          const healthyBackends = lb.backends.filter((b) => b.health && !b.draining).length;
          metrics[node] = { cpu: null, memory: null, connections: lb.active + lb.pending, rps: completed, errorRate: ratio(rejected, received),
            health: healthyBackends === 0 ? "failed" : rejected > 0 ? "saturated" : lb.pending > 0 ? "degraded" : "healthy" };
          continue;
        }
        const ids = (members.get(node) ?? []).filter((id) => runtime.inspect(id) !== undefined);
        if (!ids.length) { metrics[node] = { cpu: null, memory: null, connections: null, rps: null, errorRate: null, health: "unknown" }; continue; }
        let used = 0, available = 0, knownCpu = false, completed = 0, received = 0, failed = 0, queued = 0, serving = 0, sessions: number | null = null;
        for (const id of ids) {
          const r = runtime.inspect(id) as Station, cpu = r.compute?.cpu, p = previous.get(id);
          const refused = (r as { sessionRefused?: number }).sessionRefused ?? 0;
          const c: Counters = { received: r.received + refused, completed: r.completed, failed: (caches.has(id) ? 0 : r.failed) + r.rejected + refused, queued: r.queued, serving: r.serving,
            used: cpu ? cpu.appCoreUs + cpu.competitorCoreUs : 0, available: cpu ? cpu.availableCoreUs : null, consumed: r.consumedCoreUs };
          // CPU is the node's running app processes only: reserved replica slots and helper processes do not dilute it.
          if (!id.includes("/") && runtime.up(id)) {
            if (c.available !== null) { knownCpu = true; used += c.used - (p?.used ?? 0); available += c.available - (p?.available ?? 0); }
            else if (cores.has(id)) { knownCpu = true; used += c.consumed - (p?.consumed ?? 0); available += cores.get(id)! * (now - previousAt); }
          }
          queued += c.queued; serving += c.serving;
          // A database's connections are its open sessions (each app server's pooled connections), not its queue.
          const open = (r as { sessions?: number }).sessions;
          if (typeof open === "number") sessions = (sessions ?? 0) + open;
          // Throughput counts only the node's own entry resources, not its helper processes.
          if (!id.includes("/")) { completed += c.completed - (p?.completed ?? 0); received += c.received - (p?.received ?? 0); failed += c.failed - (p?.failed ?? 0); }
          previous.set(id, c);
        }
        const cpu = knownCpu && available > 0 ? Math.min(100, (used / available) * 100) : null;
        const errorRate = ratio(failed, received), pool = ready.get(node);
        // A pool is down with no ready replica; any other node when its own resource is down (crashed).
        const down = pool ? pool.ready === 0 : !runtime.up(node);
        metrics[node] = { cpu, memory: null, connections: sessions ?? queued + serving, rps: completed, errorRate,
          health: down ? "failed" : (cpu ?? 0) >= 95 || (errorRate ?? 0) > 0.05 ? "saturated" : (cpu ?? 0) >= 80 || (errorRate ?? 0) > 0.01 ? "degraded" : "healthy",
          ...(pool ? { replicas: pool } : {}) };
      }
      for (const resource of compiled.input.resources) {
        if (resource.kind !== "delivery-queue" || !compiled.semantic.nodes.find((n) => n.id === resource.id)?.profile.includes("canvas-async/1")) continue;
        const queue = runtime.inspectQueue(resource.id);
        const workers = compiled.input.resources.filter((r) => r.kind === "async-worker" && r.broker === resource.id).map((r) => runtime.inspectWorker(r.id));
        if (metrics[resource.id] && queue && queue.ready > 0 && metrics[resource.id]!.health === "healthy") metrics[resource.id]!.health = "degraded";
        if (metrics[resource.id]) metrics[resource.id]!.asyncQueue = { version: 1, published: queue?.accepted ?? null, completed: workers.length && workers.every(Boolean) ? workers.reduce((n, w) => n + w!.processed, 0) : null, readyDepth: queue?.ready ?? null, oldestReadyAgeSeconds: queue?.oldestReadyAgeUs == null ? null : queue.oldestReadyAgeUs / SECOND, inFlight: queue?.inFlight ?? null, redeliveries: queue?.redelivered ?? null, deadLettered: queue?.deadLettered ?? null };
      }
      const offered = caller.offered - previousCaller.offered, completedRps = caller.completed - previousCaller.completed, failedRps = caller.failed - previousCaller.failed;
      const sorted = responses.sort((a, b) => a - b), latencyMs = { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
      const lost = ratio(failedRps, offered) ?? 0, nodes = Object.values(metrics);
      const overallHealth = lost > 0.2 || nodes.some((m) => m.health === "failed") && lost > 0.05 ? "critical"
        : lost > 0.05 || nodes.some((m) => m.health === "saturated") ? "saturated"
        : lost > 0.01 || nodes.some((m) => m.health === "degraded" || m.health === "failed") ? "degraded" : "healthy";
      previousAt = now; previousCaller = { ...caller }; previousLb = lbNow; responses = [];
      return { simulatedSeconds: now / SECOND, offeredRps: offered, completedRps, failedRps, latencyMs, metrics, overallHealth };
    },
  };
}

// A live run that accepts actions. Each action rebuilds the run from its design plus every action so far,
// then catches up to the current second in steps the caller paces, so a long run never blocks its host.
// Model 2 is deterministic, so the seconds already shown never change. The run holds still while catching up.
export function createActionableLiveModel2(design: SavedProductDesign, base: ProductContract, nodeIds: string[]) {
  const actions: TimedAction[] = [];
  let compiledInput: CompiledProduct;
  const build = () => {
    const compiled = compileProduct(design, withTimeline(base, actions));
    if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => d.message).join("; "));
    const built = createLiveModel2(compiled.value, nodeIds); compiledInput = compiled.value; return built;
  };
  let run = build(), shown = 0;
  let rebuilding: { run: ReturnType<typeof createLiveModel2>; target: number } | null = null;
  return {
    get compiled() { return compiledInput; },
    get simulatedSeconds() { return shown; },
    get horizon() { return run.horizon; },
    evidence: () => run.evidence(),
    applicationFlowEvidence: () => run.applicationFlowEvidence(),
    get actions(): readonly TimedAction[] { return actions; },
    get catchingUp() { return rebuilding !== null; },
    // Advances the rebuilt run by at most `step` simulated seconds; true once it has replaced the shown run.
    catchUp(step = 1) {
      if (!rebuilding) return true;
      if (!rebuilding.run.catchUp(rebuilding.target, step)) return false;
      run = rebuilding.run; rebuilding = null; return true;
    },
    advanceSecond() {
      if (rebuilding) throw new Error("The run is still catching up after an action");
      run.advanceSecond(); shown = run.simulatedSeconds;
    },
    project() { return run.project(); },
    // The action takes effect just after the current second, which has already been shown. A design or action
    // Model 2 cannot compile is refused here and leaves the run unchanged. A second action while catching up joins the same rebuild.
    apply(action: TimedAction extends infer A ? A extends TimedAction ? Omit<A, "atUs"> : never : never) {
      actions.push(JSON.parse(JSON.stringify({ ...action, atUs: shown * SECOND + 1 })) as TimedAction);
      let next;
      try { next = build(); } catch (error) { actions.pop(); throw error; }
      rebuilding = { run: next, target: shown };
    },
  };
}

