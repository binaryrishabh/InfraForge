import { expect, test } from "bun:test";
import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { configuration } from "../comparison/design";
import { databaseLayout, databaseWorkload } from "./databaseReplication.fixture";

test("replication persists through save/live/capture/replay/comparison and rejects invalid intent", () => {
  const layout = databaseLayout(); delete layout.resources.at(-1)!.databaseReplication; delete layout.resources.at(-1)!.dataKeyspace;
  expect(captureRunInputs(layout, databaseWorkload).adapterProfiles).toEqual(["traffic-evidence/2"]);
  expect(configuration(layout.resources.at(-1)!)).not.toHaveProperty("databaseReplication");
  const policy = { version: 1 as const, enabled: true as const, replicationDelayMs: 60000, readPolicy: "replica-preferred" as const };
  layout.resources.at(-1)!.databaseReplication = policy;
  for (const schema of [LayoutSchema, LiveTopologySchema]) expect(layout.resources).toEqual(schema.parse(layout).resources);
  expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).errors).toEqual([]);
  const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, databaseWorkload, "database-ha"))));
  expect(input.adapterProfiles).toEqual(["db-replication/1"]);
  expect(buildContractFromRunInputs(input, 10)).not.toHaveProperty("refused");
  for (const adapterProfiles of [undefined, []]) expect(buildContractFromRunInputs({ ...input, adapterProfiles }, 10)).toHaveProperty("refused");
  expect(() => readRunInputs({ ...input, adapterProfiles: ["db-replication/1", "db-replication/1"] })).toThrow();
  expect(configuration(layout.resources.at(-1)!)).toHaveProperty("databaseReplication", policy);
  for (const value of [null, {}, { ...policy, version: 2 }, { ...policy, enabled: false }, { ...policy, replicationDelayMs: 0 }, { ...policy, replicationDelayMs: 60001 }, { ...policy, replicationDelayMs: 1.5 }, { ...policy, readPolicy: "any" }, { ...policy, extra: true }]) {
    Object.assign(layout.resources.at(-1)!, { databaseReplication: value });
    for (const schema of [LayoutSchema, LiveTopologySchema]) expect(schema.safeParse(layout).success).toBe(false);
    expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).errors.length).toBeGreaterThan(0);
  }
  delete layout.resources.at(-1)!.databaseReplication; layout.resources[0]!.databaseReplication = policy;
  expect(LayoutSchema.safeParse(layout).success).toBe(false);
});
