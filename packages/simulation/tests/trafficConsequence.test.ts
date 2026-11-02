import { expect, test } from "bun:test";
import { trafficConsequence } from "./trafficConsequence.fixture";

test("same mean offered traffic develops a wider real tail under Poisson arrivals and variable app CPU", () => {
  const a = trafficConsequence(false), b = trafficConsequence(true);
  console.info("traffic-reality-consequence", JSON.stringify({ arithmetic: "one worker held for app CPU 3000us + DB CPU 1000us + dependency transport 218us; 200rps * 4218us = 0.8436 worker utilization", evenFixed: a, poissonVariable: b }));
  expect(Math.abs(b.offered / a.offered - 1)).toBeLessThan(0.05);
  expect(b.p99Ms).toBeGreaterThanOrEqual(a.p99Ms);
  expect(b.p99Ms / b.p50Ms).toBeGreaterThan(a.p99Ms / a.p50Ms);
  expect(a.completed + a.failed + a.inFlight).toBe(a.offered);
  expect(b.completed + b.failed + b.inFlight).toBe(b.offered);
});
