import { afterEach, test, expect } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FlowSection } from "../src/features/canvas/components/inspector/FlowSection";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import type { Resource } from "@infraforge/domain/resource";
import { validateConnection } from "@infraforge/domain/validation";
afterEach(() => useCanvasStore.getState().clearCanvas());
test("flow editor renders connected services, thresholds and missing-edge validation under run lock",()=>{
  const resource:Resource={id:"app",type:"Virtual Machine",x:0,y:0,applicationFlow:{schema:"application-flow/1",operations:{read:{steps:[{id:"parallel",kind:"parallel",wait:2,branches:[{id:"inventory",kind:"call",edge:"inventory-edge"},{id:"pricing",kind:"call",edge:"missing"}]}]}}}};
  useCanvasStore.setState({resources:[resource,{id:"inventory",type:"Virtual Machine",x:1,y:1}],connectionLines:[{id:"inventory-edge",sourceId:"app",targetId:"inventory",sourceType:"Virtual Machine",targetType:"Virtual Machine",port:80}]});
  const html=renderToStaticMarkup(<FlowSection resource={resource} disabled/>);
  expect(html).toContain("disabled");expect(html).toContain("thread-per-request: worker held while waiting");
  expect(html).toContain("inventory-edge");expect(html).toContain("Missing edge: missing");expect(html).toContain("Required responses");expect(html).not.toContain("[object Object]");
});
test("canvas can connect VM services and flow patches participate in undo/redo and run locking",()=>{
  expect(validateConnection("Virtual Machine","Virtual Machine", "draw").valid).toBe(true);expect(validateConnection("Virtual Machine","Load Balancer", "draw").valid).toBe(true);
  const resource:Resource={id:"app",type:"Virtual Machine",x:0,y:0};
  useCanvasStore.setState({resources:[resource],undoStack:[],redoStack:[],liveLocked:false,isDeploying:false});
  const applicationFlow:Resource["applicationFlow"]={schema:"application-flow/1",operations:{read:{steps:[{id:"cpu",kind:"compute"}]}}};
  updateResource("app",{applicationFlow});expect(useCanvasStore.getState().resources[0]!.applicationFlow).toEqual(applicationFlow);
  undo();expect(useCanvasStore.getState().resources[0]!.applicationFlow).toBeUndefined();redo();expect(useCanvasStore.getState().resources[0]!.applicationFlow).toEqual(applicationFlow);
  useCanvasStore.setState({liveLocked:true});updateResource("app",{applicationFlow:undefined});expect(useCanvasStore.getState().resources[0]!.applicationFlow).toEqual(applicationFlow);
  useCanvasStore.setState({liveLocked:false});
});


import { createRunHost } from "../src/features/model2Run/worker/host";
import type { FromWorker } from "../src/features/model2Run/protocol";
import { resolveWorkload } from "@infraforge/domain/workload";
import { ApplicationFlowLog } from "../src/features/live/ApplicationFlowLog";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildModel2Contract } from "@infraforge/simulation/internal-product";
for (const degraded of [false, true]) test(`worker carries bounded flow joins and truncation through the live store, degraded=${degraded}`, () => {
  const ids = ["app", "inventory", "pricing", "tax"];
  const resources: Resource[] = ids.map(id=>({id,type:"Virtual Machine",x:0,y:0}));
  resources[0]!.applicationFlow={schema:"application-flow/1",operations:{read:{steps:[{id:"cpu",kind:"compute"},{id:"join",kind:"parallel",wait:2,branches:ids.slice(1).map(id=>({id,kind:"call",edge:`app-${id}`}))}]}}};
  const messages: FromWorker[] = [], queue: Array<()=>void> = [];
  const host = createRunHost(message=>messages.push(structuredClone(message)), {set:run=>{queue.push(run);return run;},clear:()=>{queue.length=0;}}, (input,horizon)=>createModel2Run(input,horizon,(...args)=>{
    const built=buildModel2Contract(...args);if("refused" in built || !degraded)return built;
    const contract=built.contract, transport=structuredClone(contract.transports.assumed!);
    const quantity={kind:"known" as const,value:1,unit:"us" as const,provenance:["test.optional-timeout"]};
    const entry=structuredClone(contract.ledger.find(row=>row.id===transport.pool.responseTimeout.provenance[0])!);
    contract.ledger.push({...entry,id:"test.optional-timeout",quantity,formula:"1",scope:"Synthetic optional timeout verification"});
    transport.pool.responseTimeout=quantity;contract.transports.optional=transport;contract.edges["app-tax"]!.transport="optional";
    return built;
  }));
  host.handle({type:"start",start:{input:{resources,connectionLines:ids.slice(1).map(id=>({id:`app-${id}`,sourceId:"app",targetId:id,sourceType:"Virtual Machine",targetType:"Virtual Machine",port:80})),workloadProfile:resolveWorkload({targetThroughput:6000,throughputUnit:"per-minute",trafficShape:"steady",readWriteRatio:1,payloadSize:"light"}),seed:"flow-parity"},horizonSeconds:5,stopAtSecond:5,speed:1}});
  while(queue.length) queue.shift()!();
  const seconds = messages.filter(m=>m.type==="second");
  expect(seconds).toHaveLength(5);
  const message = seconds.at(-1)!;
  expect(message.applicationFlow).toMatchObject({profile:"application-flow/1",retained:message.applicationFlow!.events.length});
  expect(message.applicationFlow!.retained).toBe(1000);
  expect(message.applicationFlow!.omitted).toBeGreaterThan(0);
  expect(message.applicationFlow!.events.some(e=>e.kind==="flow-join")).toBe(true);
  expect(message.applicationFlow!.events.some(e=>e.kind==="flow-branch-terminal" && e.detail.outcome===(degraded ? "rejected" : "cancelled-after-join"))).toBe(true);
  expect(message.applicationFlow!.events.some(e=>e.kind==="flow-join" && e.detail.failed===(degraded ? 1 : 0))).toBe(true);
  useSimulationStore.getState().reset();
  useSimulationStore.getState().applySnapshot({deploymentId:"flow",timestamp:"now",simulatedSeconds:5,loadFraction:1,health:"healthy",metrics:{},logs:[],applicationFlow:message.applicationFlow});
  expect(useSimulationStore.getState().applicationFlow).toEqual(message.applicationFlow);
  const html = renderToStaticMarkup(<ApplicationFlowLog evidence={{...message.applicationFlow!,omitted:3}}/>);
  expect(html).toContain("3 omitted");expect(html).toContain("truncated");expect(html).toContain("flow-join");expect(html).toContain(degraded ? "rejected" : "cancelled-after-join");
  useSimulationStore.getState().reset();
});
