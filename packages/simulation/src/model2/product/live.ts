import { createProductModel2 } from "./run";
import type { CompiledProduct } from "./contracts";

// One simulated second at a time, projected onto the canvas nodes the person drew.
// Values Model 2 does not know stay null ("Unknown"); they are never shown as zero.
export type LiveValue = number | null;
export type LiveHealth = "healthy" | "degraded" | "saturated" | "failed" | "unknown";
export interface LiveNodeMetrics {
  cpu: LiveValue; memory: LiveValue; connections: LiveValue; rps: LiveValue; errorRate: LiveValue; health: LiveHealth;
  replicas?: { ready: number; total: number };
}
export interface LiveProjection {
  simulatedSeconds: number;
  offeredRps: number; completedRps: number; failedRps: number;
  metrics: Record<string, LiveNodeMetrics>;
  overallHealth: "healthy" | "degraded" | "saturated" | "critical";
}

type Counters = { received: number; completed: number; failed: number; rejected: number; queued: number; serving: number; used: number; available: number | null; consumed: number };
type SampleResource = { id: string; received: number; completed: number; failed: number; rejected: number; queued: number; serving: number; consumedCoreUs: number;
  compute?: { cpu?: { appCoreUs: number; competitorCoreUs: number; availableCoreUs: number } } };

const SECOND = 1_000_000;
const ratio = (part: number, whole: number) => whole > 0 ? part / whole : null;

export function createLiveModel2(compiled: CompiledProduct, nodeIds: string[]) {
  const runtime = createProductModel2(compiled);
  let now = 0;
  const previous = new Map<string, Counters>();
  let previousTotals = { offered: 0, completed: 0, failed: 0 };
  let previousLb = new Map<string, { received: number; completed: number; rejected: number }>();
  // A node owns its own resource and every replica or helper named after it (vm#0, vm#0/aside).
  // Authored cores per runtime resource, for resources whose CPU is reported as consumed core-time only.
  const cores = new Map<string, number>();
  for (const r of compiled.input.resources as Array<{ id: string; cores?: { kind: string; value?: number }; execution?: { cores?: { kind: string; value?: number } } }>) {
    const q = r.cores ?? r.execution?.cores;
    if (q?.kind === "known" && typeof q.value === "number") cores.set(r.id, q.value);
  }
  let previousAt = 0;
  const owner = (resourceId: string) => nodeIds.find((n) => resourceId === n || resourceId.startsWith(`${n}#`) || resourceId.startsWith(`${n}/`));

  return {
    get simulatedSeconds() { return now / SECOND; },
    get horizon() { return runtime.horizon; },
    advanceSecond() {
      if (now + SECOND > runtime.horizon) throw new Error("The run has reached its simulated horizon");
      now += SECOND; runtime.advanceTo(now);
    },
    project(): LiveProjection {
      const e = runtime.evidence();
      const sample = e.samples.at(-1) as { resources: SampleResource[] } | undefined;
      const current = new Map<string, Counters>();
      for (const r of sample?.resources ?? []) {
        const cpu = r.compute?.cpu;
        current.set(r.id, { received: r.received, completed: r.completed, failed: r.failed, rejected: r.rejected, queued: r.queued, serving: r.serving,
          used: cpu ? cpu.appCoreUs + cpu.competitorCoreUs : 0, available: cpu ? cpu.availableCoreUs : null, consumed: r.consumedCoreUs });
      }
      const ready = new Map<string, { ready: number; total: number }>();
      for (const pool of e.product.controllers) {
        const node = owner(pool.id) ?? pool.id;
        ready.set(node, { ready: pool.replicas.filter((r) => r.state === "ready").length, total: pool.replicas.filter((r) => r.state !== "reserved").length });
      }
      const metrics: Record<string, LiveNodeMetrics> = {};
      for (const node of nodeIds) {
        const members = [...current.keys()].filter((id) => owner(id) === node);
        const lb = e.network.loadBalancers.find((l: { id: string }) => l.id === node);
        if (lb) {
          const before = previousLb.get(node) ?? { received: 0, completed: 0, rejected: 0 };
          const received = lb.received - before.received, completed = lb.completed - before.completed, rejected = lb.rejected - before.rejected;
          const healthyBackends = lb.backends.filter((b: { health: boolean; draining: boolean }) => b.health && !b.draining).length;
          metrics[node] = { cpu: null, memory: null, connections: lb.active + lb.pending, rps: completed, errorRate: ratio(rejected, received),
            health: healthyBackends === 0 ? "failed" : rejected > 0 ? "saturated" : lb.pending > 0 ? "degraded" : "healthy" };
          continue;
        }
        if (!members.length) { metrics[node] = { cpu: null, memory: null, connections: null, rps: null, errorRate: null, health: "unknown" }; continue; }
        let used = 0, available = 0, knownCpu = false, completed = 0, received = 0, failed = 0, queued = 0, serving = 0;
        for (const id of members) {
          const c = current.get(id)!, p = previous.get(id);
          if (c.available !== null) { knownCpu = true; used += c.used - (p?.used ?? 0); available += c.available - (p?.available ?? 0); }
          else if (cores.has(id)) { knownCpu = true; used += c.consumed - (p?.consumed ?? 0); available += cores.get(id)! * (now - previousAt); }
          queued += c.queued; serving += c.serving;
          // Throughput counts only the node's own entry resources, not its helper processes.
          if (!id.includes("/")) { completed += c.completed - (p?.completed ?? 0); received += c.received - (p?.received ?? 0); failed += c.failed - (p?.failed ?? 0) + c.rejected - (p?.rejected ?? 0); }
        }
        const cpu = knownCpu && available > 0 ? Math.min(100, (used / available) * 100) : null;
        const errorRate = ratio(failed, received), pool = ready.get(node);
        const down = pool ? pool.ready === 0 : false;
        metrics[node] = { cpu, memory: null, connections: queued + serving, rps: completed, errorRate,
          health: down ? "failed" : (cpu ?? 0) >= 95 || (errorRate ?? 0) > 0.05 ? "saturated" : (cpu ?? 0) >= 80 || (errorRate ?? 0) > 0.01 ? "degraded" : "healthy",
          ...(pool ? { replicas: pool } : {}) };
      }
      const totals = { offered: e.counts.offered, completed: e.counts.completed, failed: e.counts.rejected + e.counts.deadlineExceeded + e.counts.abandoned };
      const offered = totals.offered - previousTotals.offered, completedRps = totals.completed - previousTotals.completed, failedRps = totals.failed - previousTotals.failed;
      const lost = ratio(failedRps, offered) ?? 0, nodes = Object.values(metrics);
      const overallHealth = lost > 0.2 || nodes.some((m) => m.health === "failed") && lost > 0.05 ? "critical"
        : lost > 0.05 || nodes.some((m) => m.health === "saturated") ? "saturated"
        : lost > 0.01 || nodes.some((m) => m.health === "degraded" || m.health === "failed") ? "degraded" : "healthy";
      for (const [id, c] of current) previous.set(id, c);
      previousAt = now;
      previousTotals = totals;
      previousLb = new Map(e.network.loadBalancers.map((l: { id: string; received: number; completed: number; rejected: number }) => [l.id, { received: l.received, completed: l.completed, rejected: l.rejected }]));
      return { simulatedSeconds: now / SECOND, offeredRps: offered, completedRps, failedRps, metrics, overallHealth };
    },
  };
}
