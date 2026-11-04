import type { DatabaseReadRouting } from "@infraforge/domain/resource";

export type DatabaseMember = "primary" | "replica";
export function readRoutingAccounting(config: DatabaseReadRouting) {
  const member = () => ({ admitted: 0, committed: 0, aborted: 0, cancelled: 0, sessionRefused: 0, queryRefused: 0, peakSessions: 0, peakActive: 0, peakQueued: 0 });
  const members = { primary: member(), replica: member() };
  let staleReads = 0, maxStaleReadAgeMs = 0;
  return {
    members,
    stale(ageMs: number) { staleReads++; maxStaleReadAgeMs = Math.max(maxStaleReadAgeMs, ageMs); },
    evidence() { return { version: 1 as const, policy: config.policy, fallback: "unavailable-only; capacity refuses" as const,
      sessionModel: "Bounded router connections bind an idle member session at transaction admission; transactions stay on that member." as const,
      staleReads, maxStaleReadAgeMs, members: { primary: { ...members.primary }, replica: { ...members.replica } } }; },
  };
}
