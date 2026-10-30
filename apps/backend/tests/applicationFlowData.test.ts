import { expect, test } from "bun:test";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import type { Resource } from "@infraforge/domain/resource";
import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { compareInputs } from "../comparison/inputs";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { captureSnapshot } from "../simulator/snapshot";
import type { SimulationInstance } from "../simulator/instance";
import { designDifference, normalizedTopology, unambiguous } from "../comparison/design";

function design() {
  const resources:Resource[]=[{id:"app",type:"Virtual Machine",x:0,y:0,applicationFlow:{schema:"application-flow/2",operations:{read:{steps:[{id:"cpu",kind:"compute"},{id:"read",kind:"data",edge:"app-cache",operation:"read"}]},write:{steps:[{id:"write",kind:"data",edge:"app-cache",operation:"write"}]}}}},{id:"cache",type:"Cache",x:1,y:0},{id:"db",type:"Database",x:2,y:0}];
  const connectionLines=[{id:"app-cache",sourceId:"app",targetId:"cache",sourceType:"Virtual Machine",targetType:"Cache",port:6379},{id:"cache-db",sourceId:"cache",targetId:"db",sourceType:"Cache",targetType:"Database",port:5432}];
  return {resources,connectionLines};
}
const workload={targetThroughput:60,throughputUnit:"per-minute" as const,trafficShape:"steady" as const,readWriteRatio:0.5,payloadSize:"light" as const};

test("/2 data steps save/reload with captured profile, strict validation and comparison identity",()=>{
  const d=design();
  expect(validateDeploymentReadiness(d.resources,d.connectionLines).valid).toBe(true);
  for(const schema of [LayoutSchema,LiveTopologySchema])expect<Resource[]>(schema.parse(JSON.parse(JSON.stringify(d))).resources).toEqual(d.resources);
  const input=readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(d,workload,"data-parity"))));
  expect(input.adapterProfiles).toEqual(["failure-cause/1","application-flow/2"]);
  expect(buildContractFromRunInputs({...input,adapterProfiles:undefined},4)).toHaveProperty("refused");
  const old=structuredClone(d);old.resources[0]!.applicationFlow!.schema="application-flow/1";
  expect(LayoutSchema.safeParse(old).success).toBe(false);
  const edited=structuredClone(d);edited.resources[0]!.applicationFlow!.operations.read!.steps.reverse();
  expect(designDifference(d,edited).reconfigured[0]!.fields[0]!.field).toBe("applicationFlow");
  for(const patch of [{kind:"data",edge:"app-cache"},{kind:"data",edge:"app-cache",operation:"read",retry:1},{kind:"data",edge:"app-cache",operation:"publish"}]) {
    const bad=structuredClone(d);bad.resources[0]!.applicationFlow!.operations.read!.steps=[{id:"bad",...patch}] as never;
    expect(LayoutSchema.safeParse(bad).success).toBe(false);
  }
});

for(const cause of [false,true])test(`browser/server data evidence and terminal capture are equal, cause=${cause}`,()=>{
  const d=design(),input=readRunInputs(captureRunInputs(d,workload,"data-parity"));
  input.adapterProfiles=cause?["failure-cause/1","application-flow/2"]:["application-flow/2"];
  const browser=createModel2Run(input,4),server=createModel2Engine(input,4,buildModel2Contract);
  for(let i=0;i<4;i++) {browser.advance();server.advance();expect(browser.applicationFlowEvidence()).toEqual(server.applicationFlowEvidence());}
  const instance:SimulationInstance={model2:server,tickCount:4,pendingLogs:[],speed:1,lastCheckpointAt:0,accumulatedCostUsd:0,topology:d,topologyRevision:0,actions:new Map(),acknowledge:null,metricsComputedAt:null,metricsTopologyRevision:0};
  const record=JSON.parse(JSON.stringify(captureSnapshot("data",instance,"terminal"))) as ReturnType<typeof captureSnapshot>;
  expect(record.applicationFlow).toEqual(browser.applicationFlowEvidence());
  expect(record.applicationFlow!.profile).toBe("application-flow/2");
  expect(record.applicationFlow!.events.filter(e=>e.kind==="flow-branch-terminal").map(e=>e.detail.operation)).toEqual(["write","read","write","read"]);
  expect(record.applicationFlow!.events.every(e=>!e.kind.includes("retry"))).toBe(true);
});


test("swapping data-edge IDs changes topology identity and connection differences", () => {
  const d = design();
  d.connectionLines.unshift({ id: "app-db", sourceId: "app", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432 });
  d.resources[0]!.applicationFlow!.operations = { read: { steps: [
    { id: "direct", kind: "data", edge: "app-db", operation: "read" },
    { id: "cached", kind: "data", edge: "app-cache", operation: "read" },
  ] } };
  const a = captureRunInputs(d, { ...workload, targetThroughput: 60000, readWriteRatio: 1 }, "edge-bindings"), b = structuredClone(a);
  for (const edge of b.connectionLines) if (edge.sourceId === "app") edge.id = edge.id === "app-db" ? "app-cache" : "app-db";
  // Both captured inputs still compile; unchanged flow references now bind different targets.
  const before = createModel2Run(a, 1), after = createModel2Run(b, 1);
  before.advance(); after.advance();
  expect(before.applicationFlowEvidence()!.events.find(e => e.kind === "flow-branch-start")!.detail.target).toBe("db");
  expect(after.applicationFlowEvidence()!.events.find(e => e.kind === "flow-branch-start")!.detail.target).toBe("cache/aside");
  expect(a.resources).toEqual(b.resources);
  const comparison = compareInputs(a, b);
  expect(comparison.grade).toBe("one-change-design");
  expect(comparison.facets.topology).toBe("different");
  expect(normalizedTopology(a)).not.toEqual(normalizedTopology(b));
  expect(comparison.design).toEqual(designDifference(a, b));
  expect(comparison.design!.addedConnections).toEqual([
    { id: "app-cache", sourceId: "app", targetId: "db", port: 5432 },
    { id: "app-db", sourceId: "app", targetId: "cache", port: 6379 },
  ]);
  expect(comparison.design!.removedConnections).toEqual([
    { id: "app-cache", sourceId: "app", targetId: "cache", port: 6379 },
    { id: "app-db", sourceId: "app", targetId: "db", port: 5432 },
  ]);
  expect(comparison.design!.connectionOrder).toEqual({
    earlier: a.connectionLines.map(({ id, sourceId, targetId, port }) => ({ id, sourceId, targetId, port })),
    later: b.connectionLines.map(({ id, sourceId, targetId, port }) => ({ id, sourceId, targetId, port })),
  });
  const duplicated = structuredClone(a); duplicated.connectionLines[1]!.id = duplicated.connectionLines[0]!.id;
  expect(unambiguous(duplicated)).toBe(false);
  expect(compareInputs(a, duplicated).grade).toBe("side-by-side-only");
  const duplicatePath = structuredClone(a); duplicatePath.connectionLines.push({ ...duplicatePath.connectionLines[0]!, id: "other-id" });
  expect(unambiguous(duplicatePath)).toBe(false);
});
