import { expect, test } from "bun:test";
import type { ReportCheckpoint } from "@infraforge/contracts/reports";
import { compareTraffic } from "../comparison/traffic";

const a: ReportCheckpoint = { resources: [], traffic: { offeredRps: 1, completedRps: 1, failedRps: 0, latencyMs: { p50: 1, p95: 1 },
  wholeRun: { version: 1, throughSecond: 10, completed: 100, failed: 0, deadlineExceeded: 0, abandoned: 0, inFlight: 0, minMs: 1, maxMs: 2,
    percentiles: { p50: { lowMs: 1, highMs: 1.023 }, p95: { lowMs: 2, highMs: 2.047 }, p99: { lowMs: 2, highMs: 2.047 } },
    resolution: "log-linear-32/1", relativeErrorBound: 0.03125, window: "whole run from start through this second" } } };

test("whole-run upper bounds permit deltas only for known exact terminal pairs", () => {
  const b = structuredClone(a); b.traffic!.wholeRun!.percentiles.p99 = { lowMs: 3, highMs: 3.007 };
  const rows = compareTraffic(a, b, true).filter(m => m.field.includes("upper bucket bound"));
  expect(rows).toHaveLength(3);
  expect(rows[2]).toMatchObject({ earlier: 2.047, later: 3.007, delta: 3.007 - 2.047 });
  const withheld = compareTraffic(a, b, false).filter(m => m.field.includes("upper bucket bound"));
  expect(withheld).toHaveLength(3); expect(withheld.every(m => m.delta === null && !!m.withheldReason)).toBe(true);
  // One percentile too sparse in one run: compared where both have it, explained where only one does.
  b.traffic!.wholeRun!.percentiles.p99 = null;
  const sparse = compareTraffic(a, b, true).filter(m => m.field.includes("upper bucket bound"));
  expect(sparse.map(m => m.delta === null)).toEqual([false, false, true]);
  expect(sparse[2]).toMatchObject({ earlier: 2.047, later: null, withheldReason: "Recorded for the earlier run but not the later run. Too few requests completed in that run for this percentile. A direct comparison is unavailable." });
  // No whole-run block in one run: its inputs say whether the marker was absent (an older capture) or the block is simply missing.
  delete b.traffic!.wholeRun;
  const missing = compareTraffic(a, b, true).filter(m => m.field.includes("upper bucket bound"));
  expect(missing).toHaveLength(3);
  for (const m of missing) expect(m).toMatchObject({ later: null, delta: null, withheldReason: expect.stringContaining("Whole-run percentiles were not recorded for that run.") });
  const older = { version: 2, adapterProfiles: [] } as never, marked = { version: 2, adapterProfiles: ["traffic-evidence/2"] } as never;
  expect(compareTraffic(a, b, true, [marked, older]).find(m => m.field.includes("p99"))!.withheldReason).toContain("captured before whole-run percentiles were recorded");
  expect(compareTraffic(a, b, true, [marked, marked]).find(m => m.field.includes("whole run"))!.withheldReason).toContain("were not recorded for that run");
});
