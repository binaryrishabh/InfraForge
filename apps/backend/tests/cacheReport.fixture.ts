// Successful evidence comes only from real engine captures; mutations prove refusal.
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { findLearningLesson } from "../learning/registry";
import { buildRunReport } from "../reports/report";
import { answers, attemptRow, definition, REFERENCE } from "./challengeHarness";

export function cacheReportFixture() {
  const rows = ["reuse-before-expiry", "share-a-cache-fill"].flatMap(id => {
    const d = definition(id);
    return [d.starter!, REFERENCE[id]!].map(design => attemptRow(d, design, answers(d, {"database-health": "healthy"})));
  });
  const capture = (row: typeof rows[number]) => row.terminalSnapshot as SimulationSnapshot;
  const base = rows[1]!;
  const variant = (change: (row: typeof base) => void) => { const row = structuredClone(base); change(row); return buildRunReport(row); };
  return {
    lessons: ["reuse-before-expiry", "share-a-cache-fill", "cache-or-database", "catalogue-link-flash"].map(id => ({old: findLearningLesson(id, 1), current: findLearningLesson(id)})),
    reports: rows.map(row => buildRunReport(row)),
    // JSON is the persistence boundary; dates on the StoredRun envelope remain Dates.
    roundTrips: rows.map(row => buildRunReport({...row, terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot))})),
    captures: rows.map(row => capture(row)),
    missing: variant(row => { for (const m of Object.values(capture(row).metrics)) { delete m.cache; delete m.applicationHelpers; } }),
    unknown: variant(row => { capture(row).metrics.cache!.cache!.hits = null; }),
    invalid: variant(row => { capture(row).metrics.cache!.cache!.hits = -1; }),
    duplicateHelper: variant(row => { const h = Object.values(capture(row).metrics).find(m => m.applicationHelpers)!.applicationHelpers!; h.helpers.push(h.helpers[0]!); }),
    checkpointOnly: variant(row => { row.simulationState = row.terminalSnapshot; row.terminalSnapshot = null; }),
  };
}
if (import.meta.main) console.log(JSON.stringify(cacheReportFixture()));
