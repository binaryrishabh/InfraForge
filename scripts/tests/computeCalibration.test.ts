import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { computeCalibration, readComputeMeasurements } from "../reality/compute-calibration";
import { validateLedger } from "../../packages/simulation/src/reality/ledger";
import { computeProofs } from "../reality/compute-proofs";

test("discrete compute profiles replay held-out measurements without fitting held-out configurations", () => {
  const data = readComputeMeasurements(), report = computeCalibration(data);
  expect(report).toEqual(JSON.parse(readFileSync(new URL("../../docs/reality/m2c-calibration.json", import.meta.url), "utf8")));
  expect(report.results.length).toBe(48); expect(report.fitted.length).toBe(8); expect(validateLedger(report.ledger)).toEqual([]);
  expect(report.fitted.every((p) => ![2, 8].includes(p.workers))).toBe(true);
  expect(report.results.filter((p) => p.configurationHoldout).every((p) => p.modelClaim.startsWith("unsupported-transfer"))).toBe(true);
  expect(report.candidates.every((p) => p.freeMode === "forbidden" && p.validity.ranges.workers!.min === p.validity.ranges.workers!.max)).toBe(true);
  expect(report.results.every((r) => r.modeledResident === "unknown")).toBe(true);
});
test("corrupt holdout exposes errors without influencing fitted CPU demand or accepted point domains", () => {
  const data = readComputeMeasurements(), before = computeCalibration(data);
  for (const c of data.cpu) for (const r of c.records) if (r.split === "holdout") r.cpuCoreUs *= 10;
  const changed = computeCalibration(data); expect(changed.fitted).toEqual(before.fitted); expect(changed.candidates).toEqual(before.candidates);
  expect(changed.summaries.find((s) => s.split === "holdout")!.cpuMARE).toBeGreaterThan(0.8);
});

test("compute teaching artifacts conserve ownership and competitor work changes caller outcomes", () => {
  const proofs = computeProofs(); expect(proofs).toEqual(JSON.parse(readFileSync(new URL("../../docs/reality/m2c-proofs.json", import.meta.url), "utf8")));
  const control = proofs.find((p) => p.name === "E-control")!, competitor = proofs.find((p) => p.name === "E-competition")!;
  expect(competitor.resources[0]!.compute!.cpu.competitorCoreUs).toBeGreaterThan(0);
  expect(competitor.counts.completed).toBeLessThan(control.counts.completed);
  const small = proofs.find((p) => p.name === "F-memory-small")!, large = proofs.find((p) => p.name === "F-memory-large")!;
  expect(large.counts).toEqual(small.counts);
  expect(large.phases[1]!.resources[0]!.compute!.memory.knownSubtotalBytes).toBeGreaterThan(small.phases[1]!.resources[0]!.compute!.memory.knownSubtotalBytes);
});
