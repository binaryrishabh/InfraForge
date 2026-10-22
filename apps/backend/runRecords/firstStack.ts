import type { RunRecord } from "@infraforge/contracts/reports";
import { firstStackReport, type FirstStackStoredReportRow } from "../firstStack/report";
import { readRunRecord } from "./schema";

export function firstStackRunRecord(row: FirstStackStoredReportRow, serverTariffs?: unknown): RunRecord {
  const report = firstStackReport(row, serverTariffs);
  return readRunRecord({ schema: "infraforge-run-record/1", id: row.id, designId: row.lineage.infrastructureId, status: row.status,
    createdAt: row.createdAt.toISOString(), updatedAt: (row.updatedAt ?? row.createdAt).toISOString(),
    engine: { lineage: "2", version: "first-stack/1", source: row.engine.source },
    reference: { engine: "2", store: "FirstStackRun", id: row.id },
    availability: { report: report.origin === "unavailable" ? "unavailable" : "readable", execution: "unavailable", replay: "unavailable",
      reasons: ["Historical replay requires a qualified compatible pinned executor and an owned durable server prefix; reading does not execute.",
        ...(report.origin === "unavailable" ? report.unknown : [])] },
    ...(row.lineage.migratedFrom ? { lineage: { kind: "migrated-from", source: row.lineage.migratedFrom } } : {}),
    experiment: { inputSchema: report.origin === "unavailable" ? null : "infraforge-first-stack-submission/1", input: report.origin === "unavailable" ? null : JSON.parse(row.input), horizonSeconds: report.interval.requestedThroughUs === null ? null : report.interval.requestedThroughUs / 1_000_000 },
    evidence: { reportSchema: report.schema, report, unknown: report.unknown } });
}
