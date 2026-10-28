import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { generateLandingSample, samplePath } from "../landing-sample";

// The landing page shows one recorded run. It must be exactly what the engine produces
// for the challenge's unchanged starter, workload, seed and scheduled crash.
test("the landing sample is the engine's output for the unchanged challenge attempt", () => {
  const committed = JSON.parse(readFileSync(samplePath, "utf8"));
  const fresh = generateLandingSample();
  expect(committed).toEqual(fresh);
  expect(fresh.points.map((p) => p.t)).toEqual(Array.from({ length: fresh.evaluation }, (_, i) => i + 1));
  // The crash lands after the tick at its second: that tick is measured before the fault.
  const target = fresh.stations.findIndex((s) => s.id === fresh.fault.target);
  expect(fresh.points[fresh.fault.at - 1]!.resources[target]![0]).not.toBe(3);
  expect(fresh.points[fresh.fault.at]!.resources[target]![0]).toBe(3);
}, 60000);
