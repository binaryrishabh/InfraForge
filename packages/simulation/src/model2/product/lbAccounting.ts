import type { CausalObserver } from "../workload/causal";

export interface LbAccounting {
  profile: "lb-accounting/1";
  // LB counters count calls; backend counters count attempts. Queue counters count
  // admissions that actually wait, not current queue depth. They are not disjoint totals.
  rejectedAtLb: number; queuedAtLb: number; acceptedByBackend: number;
  queuedAtVm: number; rejectedByVm: number; timedOutDownstream: number;
}

/** Fixed counters per LB; no retained request history or dependence on trace retention. */
export function lbAccountingEvidence(ids: string[]) {
  const counters = new Map(ids.map(id => [id, { profile: "lb-accounting/1" as const, rejectedAtLb: 0, queuedAtLb: 0, acceptedByBackend: 0, queuedAtVm: 0, rejectedByVm: 0, timedOutDownstream: 0 }]));
  const observe: CausalObserver = e => {
    if (["lb-rejected", "lb-queued", "lb-attempt-terminal"].includes(e.kind)) {
      const c = counters.get(e.resource); if (!c) return;
      if (e.kind === "lb-rejected") c.rejectedAtLb++;
      else if (e.kind === "lb-queued") c.queuedAtLb++;
      else if (["acquire-timeout", "connect-timeout", "response-timeout"].includes(String(e.detail.outcome))) c.timedOutDownstream++;
      return;
    }
    if (!["app-admitted", "app-queued", "app-rejected"].includes(e.kind) || !e.work) return;
    // A direct LB attempt ends with ["lb", owner, "try", ordinal, backend].
    // Descendant flow/dependency calls have another suffix and belong to their own admission gate.
    const id: unknown = JSON.parse(e.work.callId);
    if (!Array.isArray(id) || id.at(-5) !== "lb" || id.at(-3) !== "try" || id.at(-1) !== e.resource) return;
    const c = counters.get(String(id.at(-4))); if (!c) return;
    if (e.kind === "app-admitted") c.acceptedByBackend++;
    else if (e.kind === "app-queued") c.queuedAtVm++;
    else c.rejectedByVm++;
  };
  return { observe, forLb: (id: string): LbAccounting => ({ ...counters.get(id)! }) };
}
