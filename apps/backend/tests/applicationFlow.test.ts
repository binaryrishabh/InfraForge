import { test, expect } from "bun:test";
import { ResourceHealth, type Resource } from "@infraforge/domain/resource";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { captureSnapshot } from "../simulator/snapshot";
import type { SimulationInstance } from "../simulator/instance";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { designDifference, canonical } from "../comparison/design";
function design() {
  const ids=["app","inventory","pricing","tax"];
  const resources:Resource[]=ids.map(id=>({id,type:"Virtual Machine",x:0,y:0}));
  resources[0]!.applicationFlow={schema:"application-flow/1",operations:{read:{steps:[{id:"cpu",kind:"compute"},{id:"parallel",kind:"parallel",wait:2,branches:ids.slice(1).map(id=>({id,kind:"call",edge:`app-${id}`}))}]}}};
  const connectionLines=ids.slice(1).map(id=>({id:`app-${id}`,sourceId:"app",targetId:id,sourceType:"Virtual Machine",targetType:"Virtual Machine",port:80}));
  return {resources,connectionLines};
}
const workload={targetThroughput:60,throughputUnit:"per-minute" as const,trafficShape:"steady" as const,readWriteRatio:1,payloadSize:"light" as const};
test("flow survives layout save/reload and captured replay; authored branch ordering changes design identity",()=>{
  const d=design();
  for(const schema of [LayoutSchema,LiveTopologySchema])expect<Resource[]>(schema.parse(d).resources).toEqual(d.resources);
  const input=readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(d,workload,"flow-parity"))));expect(input.resources).toEqual(d.resources);
  const swapped=structuredClone(d), group=swapped.resources[0]!.applicationFlow!.operations.read!.steps[1]!;
  if(group.kind!=="parallel")throw Error("parallel");group.branches.reverse();
  expect(canonical(d)).not.toBe(canonical(swapped));
  expect(designDifference(d,swapped).reconfigured[0]!.fields[0]!.field).toBe("applicationFlow");
  for(const steps of [[],[{id:"x",kind:"return"}],[{id:"p",kind:"parallel",wait:4,branches:group.branches}],[{id:"p",kind:"parallel",wait:"all",branches:[{id:"x",kind:"compute"},...group.branches]}]]) {
    const bad={...d,resources:[{...d.resources[0],applicationFlow:{schema:"application-flow/1",operations:{read:{steps}}}},...d.resources.slice(1)]};
    expect(LayoutSchema.safeParse(bad).success).toBe(false);
  }
});
test("server replay carries bounded flow rows into its serializable official terminal record",()=>{
  const d=design(), input=readRunInputs(captureRunInputs(d,{...workload,targetThroughput:6000},"flow-parity"));
  const server=createModel2Engine(input,6,buildModel2Contract);
  for(let i=0;i<5;i++) server.advance();
  const instance: SimulationInstance = { model2: server, tickCount: 5, pendingLogs: [], speed: 1, lastCheckpointAt: 0,
    accumulatedCostUsd: 0, topology: d, topologyRevision: 0, actions: new Map(), acknowledge: null, metricsComputedAt: null, metricsTopologyRevision: 0 };
  const record = captureSnapshot("flow-replay", instance, "terminal");
  expect(JSON.parse(JSON.stringify(record)).applicationFlow).toEqual(record.applicationFlow);
  expect(record.applicationFlow).toMatchObject({profile:"application-flow/1", retained: record.applicationFlow!.events.length});
  expect(record.applicationFlow!.retained).toBe(1000);
  expect(record.applicationFlow!.omitted).toBeGreaterThan(0);
  expect(record.applicationFlow!.events.some(e=>e.kind==="flow-join")).toBe(true);
  expect(record.applicationFlow!.events.some(e=>e.kind==="flow-branch-terminal" && e.detail.outcome==="cancelled-after-join")).toBe(true);
  expect(record.metrics.app!.health).toBe(ResourceHealth.HEALTHY);
  const saved = JSON.stringify(record.applicationFlow);
  server.advance();
  expect(JSON.stringify(record.applicationFlow)).toBe(saved);
  delete d.resources[0]!.applicationFlow;
  d.connectionLines = [];
  d.resources = d.resources.slice(0,1);
  instance.model2 = createModel2Engine(readRunInputs(captureRunInputs(d,workload,"no-flow")),5,buildModel2Contract);
  expect(captureSnapshot("no-flow",instance,"terminal")).not.toHaveProperty("applicationFlow");
});


import { validateChallengeVersions } from "../challenges/validate";
import { CHALLENGE_VERSIONS } from "../challenges/definitions";
test("no-flow starter service edges keep the historical connection-rule error class", () => {
  for (const type of ["Virtual Machine", "Load Balancer"] as const) {
    const challenge = structuredClone(CHALLENGE_VERSIONS[0]!);
    challenge.starter = { resources: [{ id: "app", type: "Virtual Machine", x: 0, y: 0 }, { id: "target", type, x: 1, y: 0 }],
      connectionLines: [{ id: "edge", sourceId: "app", targetId: "target", sourceType: "Virtual Machine", targetType: type, port: 80 }] };
    expect(validateChallengeVersions([challenge], {})).toContain(`${challenge.id}@${challenge.version}: starter connection edge breaks the connection rules`);
    challenge.starter.resources[0]!.applicationFlow = { schema: "application-flow/1", operations: { read: { steps: [{ id: "c", kind: "call", edge: "edge" }] } } };
    expect(validateChallengeVersions([challenge], {})).not.toContain(`${challenge.id}@${challenge.version}: starter connection edge breaks the connection rules`);
  }
});



test("a degraded quorum explanation survives official terminal capture", () => {
  const d = design(), input = readRunInputs(captureRunInputs(d,workload,"degraded-replay"));
  const server = createModel2Engine(input,1,(...args)=>{
    const built = buildModel2Contract(...args);
    if ("refused" in built) return built;
    const contract = built.contract, transport = structuredClone(contract.transports.assumed!);
    const quantity = {kind:"known" as const,value:1,unit:"us" as const,provenance:["test.optional-timeout"]};
    const entry = structuredClone(contract.ledger.find(row=>row.id===transport.pool.responseTimeout.provenance[0])!);
    contract.ledger.push({...entry,id:"test.optional-timeout",quantity,formula:"1",scope:"Synthetic optional timeout verification"});
    transport.pool.responseTimeout=quantity;
    contract.transports.optional=transport;contract.edges["app-tax"]!.transport="optional";
    return built;
  });
  server.advance();
  const instance: SimulationInstance = {model2:server,tickCount:1,pendingLogs:[],speed:1,lastCheckpointAt:0,accumulatedCostUsd:0,topology:d,topologyRevision:0,actions:new Map(),acknowledge:null,metricsComputedAt:null,metricsTopologyRevision:0};
  const record = JSON.parse(JSON.stringify(captureSnapshot("degraded",instance,"terminal"))) as ReturnType<typeof captureSnapshot>;
  expect(record.applicationFlow!.events.some(row=>row.kind==="flow-join" && row.detail.failed===1)).toBe(true);
  expect(record.applicationFlow!.events.some(row=>row.kind==="flow-branch-terminal" && row.detail.branch==="tax" && row.detail.outcome==="rejected")).toBe(true);
  expect(record.traffic!.completedRps).toBe(1);
});

test("production terminal and checkpoint flow records omit bytes for long nested child identities", () => {
  const ids = Array.from({ length: 6 }, (_, i) => `service${i}_`.padEnd(64, "x"));
  const resources: Resource[] = ids.map((id, i) => ({ id, type: "Virtual Machine", x: 0, y: 0,
    applicationFlow: { schema: "application-flow/1", operations: { read: { steps: [
      ...(i < ids.length - 1
        ? [{ id: "call".padEnd(64, "s"), kind: "call" as const, edge: `edge-${i}` }]
        : [{ id: "cpu".padEnd(64, "c"), kind: "compute" as const }]),
    ] } } },
  }));
  const d = { resources, connectionLines: ids.slice(1).map((id, i) => ({ id: `edge-${i}`, sourceId: ids[i]!, targetId: id, sourceType: "Virtual Machine", targetType: "Virtual Machine", port: 80 })) };
  const input = readRunInputs(captureRunInputs(d, { ...workload, targetThroughput: 6000 }, "nested-byte-budget"));
  const server = createModel2Engine(input, 3, buildModel2Contract);
  const instance: SimulationInstance = { model2: server, tickCount: 0, pendingLogs: [], speed: 1, lastCheckpointAt: 0,
    accumulatedCostUsd: 0, topology: d, topologyRevision: 0, actions: new Map(), acknowledge: null, metricsComputedAt: null, metricsTopologyRevision: 0 };
  for (let second = 1; second <= 3; second++) {
    server.advance(); instance.tickCount = second;
    for (const kind of ["terminal", "checkpoint"] as const) {
      const record = JSON.parse(JSON.stringify(captureSnapshot("nested-bytes", instance, kind))) as ReturnType<typeof captureSnapshot>;
      const evidence = record.applicationFlow!;
      expect(record.kind).toBe(kind);
      expect(evidence.retained).toBeGreaterThan(0);
      expect(evidence.retained).toBeLessThan(1000);
      expect(evidence.omitted).toBeGreaterThan(0);
      expect(Object.values(evidence.totals).reduce((a, b) => a + b, 0)).toBe(evidence.retained + evidence.omitted);
      expect(new TextEncoder().encode(JSON.stringify(evidence)).length).toBeLessThanOrEqual(1024 * 1024);
      expect(evidence.events.some(row => row.work && JSON.parse(row.work.callId).filter((v: unknown) => v === "flow").length >= 3)).toBe(true);
    }
  }
});
