import { expect, test } from "bun:test";
import { reportOutcomeProof } from "./fixtures/reportOutcomes";

test("product Poisson retry and timeout evidence survives terminal records, report markup and comparison deltas", async () => {
  const proof = await reportOutcomeProof();
  expect(proof.repeatIdentical).toBe(true);
  expect(proof.originalsIdentical).toBe(true);
  expect(proof.limits).toEqual([]);
  for (const run of proof.runs) {
    expect(run.storedTraffic).toEqual(run.engineTraffic);
    expect(run.markupMatches).toBe(true);
    expect(run.objectiveMatches).toBe(true);
    expect(run.memoryMatches).toBe(true);
  }
  expect(proof.rowsMatch).toBe(true);
  expect(proof.comparisonMarkupMatches).toBe(true);
  expect(proof.timeoutAttempts).toBeGreaterThan(0);
  expect(proof.changedDeltas.some(delta => delta !== 0)).toBe(true);
  expect(proof.changedDeltas[5]).toBeLessThan(0);
  expect(proof.changedDeltas[6]).toBeGreaterThan(0);
  expect(proof.changedDeltas[8]).toBeLessThan(0);
  expect(proof.rows).toHaveLength(9);
  console.info("report-outcomes-proof", JSON.stringify(proof.numbers));
});
