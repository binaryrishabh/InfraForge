import type { ClientRetryCounters } from "@infraforge/contracts/telemetry";
import type { CausalObserver } from "./causal";

// Constant-size aggregates: at most four attempt ordinals and the finite cause contract.
export function clientRetryEvidence(maxAttempts: number) {
  const counts = { originalsOffered: 0, totalAttempts: 0, retriesScheduled: 0, retriesIssued: 0, recovered: 0, exhausted: 0, givenUp: 0 };
  const ineligibleByReason: Record<string, number> = {};
  const outcomes = Array.from({ length: maxAttempts }, (_, attempt) => ({ attempt, issued: 0, completed: 0, rejected: 0, cancelled: 0, deadlineExceeded: 0, abandoned: 0 }));
  const observe: CausalObserver = e => {
    const attempt = e.work?.attempt ?? 0;
    if (e.kind === "caller-offered") counts.originalsOffered++;
    if (e.kind === "client-attempt-issued") { counts.totalAttempts++; outcomes[attempt]!.issued++; if (attempt > 0) counts.retriesIssued++; }
    if (e.kind === "client-retry-scheduled") counts.retriesScheduled++;
    if (e.kind === "caller-terminal" && attempt > 0 && e.detail.outcome === "completed") counts.recovered++;
    if (e.kind === "client-retry-stopped") {
      if (e.detail.reason === "exhausted") counts.exhausted++;
      else if (e.detail.reason === "deadline-too-close") counts.givenUp++;
      else {
        const reason = ["rate-limited", "circuit-open", "session-limit", "memory-limit"].includes(String(e.detail.rootReason)) ? String(e.detail.rootReason) : "unknown";
        ineligibleByReason[reason] = (ineligibleByReason[reason] ?? 0) + 1;
      }
    }
    if (e.kind === "client-attempt-terminal") {
      const key = e.detail.outcome === "deadline-exceeded" ? "deadlineExceeded" : e.detail.outcome;
      if (key === "completed" || key === "rejected" || key === "cancelled" || key === "deadlineExceeded" || key === "abandoned") outcomes[attempt]![key]++;
    }
  };
  const measure = (): ClientRetryCounters => ({ ...counts, ineligibleByReason: { ...ineligibleByReason }, extraLoadFactor: counts.originalsOffered ? counts.totalAttempts / counts.originalsOffered : null,
    perAttemptOutcomes: outcomes.map(o => ({ ...o, inFlight: o.issued - o.completed - o.rejected - o.cancelled - o.deadlineExceeded - o.abandoned })) });
  return { observe, measure };
}
