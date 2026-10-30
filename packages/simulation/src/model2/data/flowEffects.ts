import type { DataInput } from "./contracts";

/** /2 and /3 check every owner's effects, including mixed-version service/LB calls. */
export function validateDataFlowEffects(input: DataInput) {
  if (!input.resources.some(r => r.kind === "compute" && r.applicationFlow && r.applicationFlow.schema !== "application-flow/1")) return;
  const resources = new Map(input.resources.map(r => [r.id, r]));
  const memo = new Map<string, boolean>();
  const mutates = (id: string, op: string, seen = new Set<string>()): boolean => {
    const key = JSON.stringify([id, op]), cached = memo.get(key);
    if (cached !== undefined) return cached;
    if (seen.has(key)) return true; // Cycle validation supplies the specific refusal later.
    const r = resources.get(id), chain = new Set(seen).add(key);
    let effect = true; // Unknown effects cannot enter a parallel group.
    if (r?.kind === "relational") effect = !r.plans[op] || r.plans[op]!.statements.some(s => s.kind !== "snapshot-read");
    else if (r?.kind === "load-balancer") effect = r.backends.some(id => mutates(id, op, chain));
    else if (r?.kind === "compute") {
      const flow = r.applicationFlow?.operations[op], downstream = r.downstreamByOperation?.[op] ?? r.downstream;
      effect = flow ? flow.steps.some(s => s.kind === "compute" ? false : s.kind === "publish" ? true : s.kind === "parallel" ? s.branches.some(b => mutates(b.target, b.operation ?? op, chain)) : mutates(s.target, s.operation ?? op, chain))
        : downstream ? mutates(downstream, op, chain) : !["read-only", "idempotent"].includes(input.operations.find(o => o.id === op)?.idempotency ?? "unknown");
    }
    // Cache lookups update LRU state; cache-aside reads may fill and writes invalidate.
    memo.set(key, effect); return effect;
  };
  for (const r of input.resources) if (r.kind === "compute" && r.applicationFlow) {
    for (const [op, flow] of Object.entries(r.applicationFlow.operations)) for (const step of flow.steps) {
      if (step.kind === "parallel" && step.branches.some(b => mutates(b.target, b.operation ?? op))) throw Error("Parallel calls cannot reach mutating data steps, publish, cache fills or unknown effects");
    }
  }
}
