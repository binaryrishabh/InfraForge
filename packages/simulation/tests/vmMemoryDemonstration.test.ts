import { expect, test } from "bun:test";
import { runMemoryDemonstration } from "./vmMemoryDemonstration.fixture";

test("one LB, one app VM and database: only the tight authored memory model refuses work", () => {
  const [a, b, c] = runMemoryDemonstration();
  expect(a.counts).toEqual(b.counts); expect(a.results).toEqual(b.results);
  expect(a.refused).toBe(0); expect(b.refused).toBe(0); expect(c.refused).toBeGreaterThan(0);
  expect(c.checkedRefusals).toBe(c.refused); expect(c.maxHolders).toBe(8); expect(c.maxQueued).toBeGreaterThan(0);
  expect(b.peakMiB).toBeGreaterThan(0); expect(c.peakMiB).toBe(2048);
  for (const run of [a, b, c]) {
    const failed = run.counts.rejected + run.counts.deadlineExceeded + run.counts.abandoned;
    expect(run.counts.offered).toBe(run.counts.completed + failed + run.counts.inFlight);
    expect(run.completed).toBeLessThanOrEqual(run.admitted);
    console.info("vm-memory-demonstration", JSON.stringify({ ...run, results: undefined }));
  }
});
