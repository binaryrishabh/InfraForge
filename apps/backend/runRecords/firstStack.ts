import type { RunRecord } from "@infraforge/contracts/reports";
import { firstStackReport, type FirstStackStoredReportRow } from "../firstStack/report";
import { readRunRecord } from "./schema";

export function firstStackRunRecord(row: FirstStackStoredReportRow): RunRecord {
  const report = firstStackReport(row);
  return readRunRecord({ schema: "infraforge-run-record/1", id: row.id, designId: row.lineage.infrastructureId, status: row.status,
    createdAt: row.createdAt.toISOString(), updatedAt: (row.updatedAt ?? row.createdAt).toISOString(),
    engine: { lineage: "2", version: "first-stack/1", source: row.engine.source },
    experiment: { inputSchema: "infraforge-first-stack-submission/1", input: report.origin === "unavailable" ? null : JSON.parse(row.input), horizonSeconds: report.interval.requestedThroughUs === null ? null : report.interval.requestedThroughUs / 1_000_000 },
    evidence: { reportSchema: report.schema, report, unknown: report.unknown } });
}
