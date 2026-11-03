import { expect, test } from "bun:test";
import { LatencyHistogram, latencyBucket } from "../src/model2/workload/latencyHistogram";
import { ResultBook } from "../src/model2/workload/evidence";

test("fixed buckets cover safe microseconds monotonically with at most 1/32 relative width", () => {
  let previous = -1;
  for (let e = 0; e < 53; e++) for (let sub = 0; sub < 32; sub++) {
    const value = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(2 ** e * (1 + sub / 32)));
    const b = latencyBucket(value);
    expect(b.index).toBeGreaterThanOrEqual(previous); previous = b.index;
    expect(b.lowUs).toBeLessThanOrEqual(value); expect(b.highUs).toBeGreaterThanOrEqual(value);
    expect(latencyBucket(b.lowUs)).toEqual(b); expect(latencyBucket(b.highUs)).toEqual(b);
    if (value >= 32) expect((b.highUs - b.lowUs) / b.lowUs).toBeLessThanOrEqual(1 / 32);
    else expect(b.highUs).toBe(b.lowUs);
  }
  expect(latencyBucket(0)).toEqual({ index: 0, lowUs: 0, highUs: 0 });
  expect(latencyBucket(Number.MAX_SAFE_INTEGER).index).toBe(1567);
});

test("nearest rank and Unknown match ResultBook and bounds contain deterministic empirical quantiles", () => {
  const h = new LatencyHistogram(), book = new ResultBook(1000), samples: number[] = [];
  let state = 17;
  for (let i = 0; i < 500; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const value = i % 7 === 0 ? 42 : state;
    samples.push(value); h.record(value);
    book.record({ operation: "read", outcome: "completed", responseUs: value } as Parameters<ResultBook["record"]>[0]);
    const exact = book.summary()[0]!;
    for (const [j, p] of ([0.5, 0.95, 0.99] as const).entries()) {
      const b = h.percentile(p), q = exact.percentiles[j]!;
      if (q.kind === "unknown") expect(b).toBeNull();
      else {
        expect(q.kind).toBe("exact");
        const rank = [...samples].sort((a, b) => a - b)[Math.ceil(p * samples.length) - 1]!;
        expect(b!.lowUs).toBeLessThanOrEqual(rank); expect(b!.highUs).toBeGreaterThanOrEqual(rank);
      }
    }
  }
  expect(h.count).toBe(500); expect(h.minUs).toBe(Math.min(...samples)); expect(h.maxUs).toBe(Math.max(...samples));
  expect(h.counterCount).toBe(1568); expect(h.counterBytes).toBe(12544);
  expect(() => h.record(-1)).toThrow(); expect(() => h.record(0.5)).toThrow();
});
