import { expect, test } from "bun:test";
import { wholeRunFixture } from "./wholeRun.fixture";
import { createProductModel2 } from "../src/internalProduct";
import { createLiveModel2 } from "../src/model2/product/live";

test("whole-run bounds conserve original callers and match independent causal samples through every second", () => {
  const { compiled, design } = wholeRunFixture();
  const samples: number[] = [];
  const exact = createProductModel2(compiled, undefined, e => {
    if (e.kind === "caller-terminal" && e.detail.outcome === "completed") samples.push(e.detail.responseUs as number);
  });
  const live = createLiveModel2(compiled, design.resources.map(r => r.id));
  const oneShot = createLiveModel2(compiled, design.resources.map(r => r.id));
  for (let s = 1; s <= 4; s++) {
    exact.advanceTo(s * 1000000); live.advanceSecond();
    const w = live.project().wholeRun!;
    expect(w).toBeDefined(); expect(w.throughSecond).toBe(s);
    const counts = exact.evidence().counts;
    expect(w.completed + w.failed + w.deadlineExceeded + w.abandoned + w.inFlight).toBe(counts.offered);
    expect(w.completed).toBe(samples.length);
    expect(w).toMatchObject({ completed: counts.completed, failed: counts.rejected, deadlineExceeded: counts.deadlineExceeded, abandoned: counts.abandoned, inFlight: counts.inFlight });
    const sorted = [...samples].sort((a, b) => a - b);
    for (const [key, p] of [["p50", 0.5], ["p95", 0.95], ["p99", 0.99]] as const) {
      const b = w.percentiles[key];
      if (samples.length < Math.round(1 / (1 - p))) expect(b).toBeNull();
      else { const value = sorted[Math.ceil(p * sorted.length) - 1]! / 1000; expect(b!.lowMs).toBeLessThanOrEqual(value); expect(b!.highMs).toBeGreaterThanOrEqual(value); }
    }
    expect(w.minMs).toBe(Math.min(...samples) / 1000); expect(w.maxMs).toBe(Math.max(...samples) / 1000);
  }
  oneShot.catchUp(4, 4);
  expect(oneShot.project().wholeRun).toEqual(live.project().wholeRun);
  expect(oneShot.evidence()).toEqual(live.evidence());
});

test("unmarked runs omit the block without changing compiled input or runtime evidence", () => {
  const a = wholeRunFixture(true), b = wholeRunFixture(false);
  expect(a.compiled.input).toEqual(b.compiled.input);
  const marked = createLiveModel2(a.compiled, a.design.resources.map(r => r.id));
  const old = createLiveModel2(b.compiled, b.design.resources.map(r => r.id));
  marked.advanceSecond(); old.advanceSecond();
  expect(Object.hasOwn(old.project(), "wholeRun")).toBe(false);
  expect(marked.project().wholeRun).toBeDefined();
  expect(marked.evidence().counts).toEqual(old.evidence().counts);
});
