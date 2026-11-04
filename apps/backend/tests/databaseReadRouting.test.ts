import { expect, test } from "bun:test";
import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { configuration } from "../comparison/design";
import { databaseLayout, databaseWorkload } from "./databaseReplication.fixture";

test("read routing travels through save/live/capture/replay/comparison; old captures never gain it", () => {
  const layout = databaseLayout(2000, "primary"), policy = { version: 1 as const, policy: "replica-preferred" as const };
  const old = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, databaseWorkload, "dbroute"))));
  expect(old.adapterProfiles).not.toContain("db-read-routing/1");
  expect(configuration(layout.resources.at(-1)!)).not.toHaveProperty("databaseReadRouting");
  layout.resources.at(-1)!.databaseReadRouting = policy;
  for (const schema of [LayoutSchema, LiveTopologySchema]) expect(layout.resources).toEqual(schema.parse(layout).resources);
  expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).errors).toEqual([]);
  const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, databaseWorkload, "dbroute"))));
  expect(input.adapterProfiles).toEqual(["data-keyspace/1", "data-hot-key/1", "db-replication/1", "db-read-routing/1", "traffic-evidence/2"]);
  expect(configuration(layout.resources.at(-1)!)).toHaveProperty("databaseReadRouting", policy);
  expect(buildContractFromRunInputs(input, 10)).not.toHaveProperty("refused");
  for (const adapterProfiles of [undefined, [], input.adapterProfiles!.filter(p => p !== "db-read-routing/1")]) expect(buildContractFromRunInputs({ ...input, adapterProfiles }, 10)).toHaveProperty("refused");
  expect(buildContractFromRunInputs({ ...old, adapterProfiles: [...old.adapterProfiles!, "db-read-routing/1"] }, 10)).toHaveProperty("refused");
  expect(() => readRunInputs({ ...input, adapterProfiles: [...input.adapterProfiles!, "db-read-routing/1"] })).toThrow();
  expect(buildContractFromRunInputs(old, 10)).not.toHaveProperty("refused");
});

test("backend refuses invalid routing at both layout and live boundaries", () => {
  const policy = { version: 1, policy: "primary-only" }, layout = databaseLayout();
  for (const value of [null, [], {}, { ...policy, version: 2 }, { ...policy, policy: "any" }, { ...policy, extra: true }]) {
    Object.assign(layout.resources.at(-1)!, { databaseReadRouting: value });
    for (const schema of [LayoutSchema, LiveTopologySchema]) expect(schema.safeParse(layout).success).toBe(false);
    expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).errors.length).toBeGreaterThan(0);
  }
  Object.assign(layout.resources.at(-1)!, { databaseReadRouting: policy }); delete layout.resources.at(-1)!.databaseReplication;
  expect(LayoutSchema.safeParse(layout).success).toBe(false);
  delete layout.resources.at(-1)!.databaseReadRouting; Object.assign(layout.resources[0]!, { databaseReadRouting: policy });
  expect(LayoutSchema.safeParse(layout).success).toBe(false);
});
