export type ReportJson = null | boolean | number | string | ReportJson[] | { [key: string]: ReportJson };
export interface FirstStackEvidenceEvent {
  id: string; atUs: number; kind: string; resource: string;
  work?: { rootId: string; callId: string; parentCallId?: string; attempt: number; operation: string; offeredAt: number };
  detail: Record<string, string | number | boolean | null>;
}
/** Additive cut payload. Historical cuts without it remain readable. */
export interface FirstStackReportCapture {
  schema: "first-stack-report-capture/1";
  saturation: { cpu: ReportJson; resources: ReportJson; sampledAtUs: number | null; network: ReportJson; data: ReportJson; storage: ReportJson };
  events: FirstStackEvidenceEvent[];
  selection: { roots: string[]; omitted: number; journalOmitted: number; policy: "first-3-roots-and-global/1" };
  unknown: string[];
}
export type FirstStackTail = { p: number } & (
  { kind: "exact"; valueUs: number; method: string } |
  { kind: "bounded"; minUs: number; maxUs: number; method: string } |
  { kind: "unknown"; reason: string });
export interface FirstStackReport {
  schema: "infraforge-first-stack-report/1";
  origin: "server" | "browser-untrusted" | "unavailable";
  verification: { status: "pending" | "unverified" | "verified" | "mismatch" | "interrupted" | "cancelled" | "unavailable" | "unknown"; reason: string | null };
  identity: { source: string; inputHash: string; lock: ReportJson; seed: string | null; topology: ReportJson; workload: ReportJson };
  interval: { requestedThroughUs: number | null; retainedThroughUs: number | null; fromUs: 0; boundary: "offers-at-or-before-cut; terminal-at-or-before-cut"; scope: "retained-prefix-completed-only" };
  completeness: ReportJson;
  populations: { counts: Record<string, number>; unfinished: ReportJson; denominatorUs: number; goodputPerSecond: number | null; offeredPerSecond: number | null } | null;
  latency: Array<{ operation: string; outcome: string; count: number; unit: "us"; observation: "Observed"; support: "assumption-only"; percentiles: FirstStackTail[] }>;
  saturation: FirstStackReportCapture["saturation"] | null;
  causality: { observation: "Observed"; support: "supported-logical"; complete: boolean; events: FirstStackEvidenceEvent[];
    links: Array<{ rootId: string; from: string; to: string; reason: string; interval: { fromUs: number; toUs: number } | null; evidence: string[] }>;
    selectedRoots: string[]; omitted: number | null };
  failureTimeline: Array<{ atUs: number; kind: string; resource: string; evidence: string }>;
  unknown: string[];
}
