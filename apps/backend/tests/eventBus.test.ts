import { expect, test } from "bun:test";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { configuration } from "../comparison/design";
import { eventBusLayout, eventBusWorkload } from "./eventBus.fixture";
import { runCostEstimation } from "../stages/costEstimation.stages";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";

test("event bus saved policy survives capture and replay and refuses invalid ownership or profiles", () => {
  const layout = eventBusLayout();
  const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, eventBusWorkload, "bus-capture"))));
  expect(input.adapterProfiles).toContain("event-bus/1");
  expect(configuration(input.resources.find(r => r.id === "bus")!)).toHaveProperty("eventBus", layout.resources.find(r => r.id === "bus")!.eventBus);
  expect(buildContractFromRunInputs(input, 2)).not.toHaveProperty("refused");
  for (const adapterProfiles of [undefined, [], ["event-bus/1", "event-bus/1"]] as const) expect(buildContractFromRunInputs({ ...input, adapterProfiles: adapterProfiles ? [...adapterProfiles] : undefined }, 2)).toHaveProperty("refused");
  for (const policy of [{ version: 2 }, { version: 1, capacityMessages: 0 }, { version: 1, unknown: true }]) {
    const invalid = structuredClone(input); Object.assign(invalid.resources.find(r => r.id === "bus")!, { eventBus: policy }); expect(() => readRunInputs(invalid)).toThrow();
  }
  const wrong = structuredClone(input); wrong.resources[0]!.eventBus = { version: 1 }; expect(() => readRunInputs(wrong)).toThrow();
  expect(runCostEstimation(input.resources)).toMatchObject({ status: "warning" });
  expect(runCostEstimation(input.resources).details).not.toHaveProperty("monthlyEstimate");
  expect(createModel2Engine(input, 2, buildModel2Contract).burnRatePerHourUsd()).toBeUndefined();
});
