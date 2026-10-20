import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { counterDelta, ioDeltas, validateG4, verifyG4 } from "../reality/first-stack-pilots/g4-summary";
import { g4Order } from "../reality/first-stack-pilots/g4-run";
import { findings } from "../reality/first-stack-pilots/g4-findings";

test("G4 design separates datasets and holds out an entire concurrency level", () => {
  const m = JSON.parse(readFileSync(new URL("../reality/first-stack-pilots/g4-manifest.json", import.meta.url), "utf8"));
  const order = g4Order(m);
  expect(order).toHaveLength(48);
  expect(g4Order(m)).toEqual(order);
  expect(order.filter((c: any) => c.clients === 8)).toHaveLength(24);
  expect(order.slice(0, 24).every((c: any) => c.dataset === "fitting")).toBe(true);
  for (const d of m.datasets) for (const op of m.operations) for (const clients of m.clients) {
    expect(order.filter((c: any) => c.dataset === d.id && c.operation === op && c.clients === clients).map((c: any) => c.repeat).sort()).toEqual([0, 1, 2]);
  }
});

test("G4 missing, null and reset counters remain Unknown", () => {
  expect(counterDelta({}, {}, "reads")).toBeNull();
  expect(counterDelta({ reads: null }, { reads: 3 }, "reads")).toBeNull();
  expect(counterDelta({ reads: 10 }, { reads: 3 }, "reads")).toBeNull();
  expect(counterDelta({ reads: "1" }, { reads: "4" }, "reads")).toBe(3);
  expect(counterDelta({ reads: 0 }, { reads: 0 }, "reads")).toBe(0);
  const a = { backend_type: "client backend", object: "wal", context: "normal", stats_reset: "original", writes: 10, fsyncs: null };
  expect(ioDeltas(null, [a])).toBeNull();
  expect(ioDeltas([a], [{ ...a, writes: 13 }])?.[0]).toMatchObject({ writes: 3, fsyncs: null, reads: null });
  expect(ioDeltas([a], [{ ...a, stats_reset: "reset", writes: 15 }])?.[0]).toMatchObject({ writes: null });
});

test("G4 static receipt retains populations, limits, source pins and no promotion", () => {
  const { summary, result } = verifyG4();
  expect(result).toMatchObject({ result: "PASS", campaignResult: "complete", windows: 48, failures: 0, timingPromotion: false });
  expect(summary.windows.every((w: any) => w.observation.completed > 0 && w.observation.failed === 0)).toBe(true);
  for (const mutate of [
    (s: typeof summary) => { s.timingPromotion = true; },
    (s: typeof summary) => { s.windows[0].observation.completed = null; },
    (s: typeof summary) => { s.windows.push(s.windows[0]); },
    (s: typeof summary) => { s.windows[0].split = "invented-fit"; },
    (s: typeof summary) => { s.campaign.actualLimits.postgres = "4000000000 8589934592 8589934592 128"; },
    (s: typeof summary) => { s.campaign.datasets[1].sizes.totalBytes = 1; },
  ]) { const copy = structuredClone(summary); mutate(copy); expect(() => validateG4(copy)).toThrow(); }
});

test("G4 failed and unrun cells stay explicit, never reconstructed as successful zeros", () => {
  const { summary } = verifyG4();
  summary.windows = summary.windows.slice(0, 1);
  summary.windows[0].status = "failed";
  summary.windows[0].observation = null;
  summary.campaign.failures.push({ reason: "authored watchdog test fixture" });
  expect(validateG4(summary)).toMatchObject({ result: "PASS", campaignResult: "incomplete-retained", windows: 1, planned: 48, failures: 1 });
  expect(summary.windows[0].observation).toBeNull();
});

test("G4 missing raw receipts or transaction failures cannot be called a complete campaign", () => {
  const { summary } = verifyG4();
  const missing = structuredClone(summary);
  missing.artifacts = missing.artifacts.filter(a => a.name !== `${missing.windows[0].id}-generator-cpu.txt`);
  expect(validateG4(missing).campaignResult).toBe("incomplete-retained");
  summary.windows[0].observation.failed = 1;
  expect(validateG4(summary).campaignResult).toBe("incomplete-retained");
});

test("G4 findings reproduce the pinned observations with checkout-independent line endings", () => {
  expect(readFileSync(new URL("../../docs/reality/g4-local-findings.md", import.meta.url), "utf8").replaceAll("\r\n", "\n")).toBe(findings());
});
