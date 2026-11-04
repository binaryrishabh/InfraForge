import { expect, test } from "bun:test";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { configuration } from "../comparison/design";
import { gatewayLayout, gatewayWorkload } from "./apiGateway.fixture";
test("gateway capture preserves strict route policies and requires the matching replay profile", () => {
  const layout = gatewayLayout(), input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, gatewayWorkload, "gateway"))));
  expect(input.adapterProfiles).toEqual(["api-gateway/1", "traffic-evidence/2"]);
  expect(configuration(input.resources[0]!)).toHaveProperty("apiGateway", layout.resources[0]!.apiGateway);
  expect(buildContractFromRunInputs(input, 2)).not.toHaveProperty("refused");
  for (const adapterProfiles of [undefined, [], ["api-gateway/1", "api-gateway/1"]] as const) expect(buildContractFromRunInputs({ ...input, adapterProfiles: adapterProfiles ? [...adapterProfiles] : undefined }, 2)).toHaveProperty("refused");
  for (const policy of [{ version: 2 }, { version: 1, maxInFlight: 0 }, { version: 1, authentication: true }]) {
    const invalid = structuredClone(input); Object.assign(invalid.resources[0]!, { apiGateway: policy }); expect(() => readRunInputs(invalid)).toThrow();
  }
  const wrong = structuredClone(input); wrong.resources[1]!.apiGateway = { version: 1 }; expect(() => readRunInputs(wrong)).toThrow();
});
