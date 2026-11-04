export interface DatabaseReadRoutingMemberMetrics {
  admitted: number; committed: number; aborted: number; cancelled: number;
  sessionRefused: number; queryRefused: number; peakSessions: number; peakActive: number; peakQueued: number;
  sessions: number; active: number; queued: number; sessionLimit: number; activeLimit: number; queueLimit: number; consumedCoreUs: number;
}
export interface DatabaseReadRoutingMetrics {
  version: 1; policy: "primary-only" | "replica-preferred";
  fallback: "unavailable-only; capacity refuses";
  sessionModel: string;
  staleReads: number; maxStaleReadAgeMs: number; unboundSessions: number;
  members: { primary: DatabaseReadRoutingMemberMetrics; replica: DatabaseReadRoutingMemberMetrics };
}
