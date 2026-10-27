/** Read projection only. Stored inputs, reports and engine identities are never rewritten. */
export type RunReference = { engine: "1"; store: "Deployment"; id: string } |
  { engine: "2"; store: "InternalModel2Run" | "FirstStackRun"; id: string };
export interface RunAvailability {
  report: "readable" | "partial" | "unavailable";
  execution: "available" | "execution-retired" | "unavailable";
  replay: "available" | "unavailable";
  reasons: string[];
}
export interface RunRecord {
  schema: "infraforge-run-record/1";
  id: string;
  designId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  engine: { lineage: "1" | "2"; version: string | null; source: string | null };
  experiment: { inputSchema: string | null; input: unknown; horizonSeconds: number | null };
  evidence: { reportSchema: string; report: unknown; unknown: string[] };
  reference?: RunReference;
  availability?: RunAvailability;
  lineage?: { kind: "migrated-from"; source: RunReference };
  // Guidance and prediction decorate an experiment; they never select different physics.
  learning?: { kind: "challenge" | "lesson"; profile: string | null; prediction?: unknown };
}

export interface ScoredChallengeVersion { id: string; version: string }
/** Aggregate owner projection only; hidden workloads and raw results stay on the server. */
export type FirstStackScore = {
  schema: "infraforge-score-summary/1"; challenge: ScoredChallengeVersion; rubricVersion: string;
  assessment: "incomplete" | "assessed"; earned: number; assessed: number; pending: number;
  systemPassed: boolean; support: string;
  criteria: { id: string; required: boolean; outcome: "pass" | "fail" | "Unknown"; reason: string | null }[];
} | { schema: "infraforge-scoring-unavailable/1"; state: "unavailable"; message: "Scoring unavailable" };
export type FirstStackSubmissionRecord = RunRecord & { score?: FirstStackScore | null };
/** Returned by the authenticated submission mount's /availability endpoint. */
export type FirstStackSubmissionAvailability = { available: false; engine: null } | {
  available: true; engine: { source: string; image: string }; expiresAt: number;
};
