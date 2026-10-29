import { test, expect } from "bun:test";
import { ResourceHealth, type Resource } from "@infraforge/domain/resource";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Run } from "@infraforge/simulation/model2-run";
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
test("flow browser worker entry and server replay produce identical logs, views and snapshots",()=>{
  const d=design(), input=readRunInputs(captureRunInputs(d,workload,"flow-parity"));
  const browser=createModel2Run(input,5),server=createModel2Engine(input,5,buildModel2Contract);
  for(let i=0;i<5;i++) {
    const stable=(logs:ReturnType<typeof browser.advance>)=>logs.map(({timestamp:_wall,...row})=>row);
    expect(stable(browser.advance())).toEqual(stable(server.advance()));expect(browser.view()).toEqual(server.view());
    expect(browser.applicationFlowEvidence()).toEqual(server.applicationFlowEvidence());
  }
  expect(browser.applicationFlowEvidence()!.events.some(e=>e.kind==="flow-join")).toBe(true);
  expect(browser.view().metrics.app!.health).toBe(ResourceHealth.HEALTHY);
});
