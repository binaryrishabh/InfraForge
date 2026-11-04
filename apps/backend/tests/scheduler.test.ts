import { expect, test } from "bun:test";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { configuration } from "../comparison/design";
import { schedulerLayout, schedulerWorkload } from "./scheduler.fixture";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { runCostEstimation } from "../stages/costEstimation.stages";

test("scheduler capture and layout retain bounded policy, refuse bad profiles and keep costs Unknown", () => {
  const layout = schedulerLayout(), input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, schedulerWorkload, "scheduler-capture"))));
  expect(input.adapterProfiles).toContain("scheduler/1");
  expect(configuration(input.resources[1]!)).toHaveProperty("scheduler", layout.resources[1]!.scheduler);
  expect(buildContractFromRunInputs(input, 2)).not.toHaveProperty("refused");
  for (const adapterProfiles of [undefined, [], ["scheduler/1", "scheduler/1"]] as const) expect(buildContractFromRunInputs({ ...input, adapterProfiles: adapterProfiles ? [...adapterProfiles] : undefined }, 2)).toHaveProperty("refused");
  for (const scheduler of [{ version: 2 }, { version: 1, queueCapacity: 129 }, { version: 1, extra: true }]) {
    const invalid = structuredClone(input); Object.assign(invalid.resources[1]!, { scheduler }); expect(() => readRunInputs(invalid)).toThrow();
  }
  const wrong = structuredClone(input); wrong.resources[0]!.scheduler = { version: 1 }; expect(() => readRunInputs(wrong)).toThrow();
  expect(runCostEstimation(input.resources).details).not.toHaveProperty("monthlyEstimate");
  expect(createModel2Engine(input, 2, buildModel2Contract).burnRatePerHourUsd()).toBeUndefined();
});
