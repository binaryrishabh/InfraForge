import { expect, test } from "bun:test";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { configuration } from "../comparison/design";
import { functionLayout, functionWorkload } from "./serverless.fixture";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { runCostEstimation } from "../stages/costEstimation.stages";
test("function policy survives capture and replay, refuses bad ownership/profile, keeps cost Unknown", () => {
  const layout = functionLayout(), input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, functionWorkload, "function-capture"))));
  expect(input.adapterProfiles).toContain("serverless/1"); expect(input.resources[0]!.serverless).toEqual(layout.resources[0]!.serverless);
  expect(configuration(input.resources[0]!)).toHaveProperty("serverless", layout.resources[0]!.serverless);
  expect(buildContractFromRunInputs(input, 2)).not.toHaveProperty("refused");
  for (const adapterProfiles of [undefined, [], ["serverless/1", "serverless/1"]] as const) expect(buildContractFromRunInputs({ ...input, adapterProfiles: adapterProfiles ? [...adapterProfiles] : undefined }, 2)).toHaveProperty("refused");
  for (const serverless of [{ version: 2 }, { version: 1, concurrency: 129 }, { version: 1, extra: true }]) { const invalid = structuredClone(input); Object.assign(invalid.resources[0]!, { serverless }); expect(() => readRunInputs(invalid)).toThrow(); }
  const wrong = structuredClone(input); wrong.resources[1]!.serverless = { version: 1 }; expect(() => readRunInputs(wrong)).toThrow();
  expect(runCostEstimation(input.resources).details).not.toHaveProperty("monthlyEstimate");
  expect(createModel2Engine(input, 2, buildModel2Contract).burnRatePerHourUsd()).toBeUndefined();
});
