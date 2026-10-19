/** Read projection only. Stored inputs, reports and engine identities are never rewritten. */
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
  // Guidance and prediction decorate an experiment; they never select different physics.
  learning?: { kind: "challenge" | "lesson"; profile: string | null; prediction?: unknown };
}
