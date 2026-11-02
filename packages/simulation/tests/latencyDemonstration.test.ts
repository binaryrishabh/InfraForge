import { expect, test } from "bun:test";
import { latencyDemonstration } from "./latencyDemonstration.fixture";

test("same-seed Poisson traffic reveals the actual growing tail category and retry delay", () => {
  const proof = latencyDemonstration();
  expect(proof.high.p99Ms).toBeGreaterThan(proof.low.p99Ms!);
  expect(proof.high.slowestOnePercent!.totalMs).toBeGreaterThan(proof.high.typical!.totalMs);
  expect(proof.largestTailGrowth.meanDifferenceMs).toBeGreaterThan(0);
  expect(proof.retry.meanDelayMs).toBeGreaterThan(0);
  expect(proof.retry.attempts).toBeGreaterThan(proof.retry.originals);
  expect(proof.conserved).toBeGreaterThan(0);
  expect(proof.repeatIdentical).toBe(true);
  console.info("latency-demonstration", JSON.stringify(proof));
}, 180000);
