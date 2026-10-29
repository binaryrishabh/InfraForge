import { expect, test, afterEach } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SecuritySection, SecurityReadings } from "../src/features/canvas/components/inspector/SecuritySection";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import { ResourceHealth, type Resource } from "@infraforge/domain/resource";
import { createRunHost } from "../src/features/model2Run/worker/host";
import type { FromWorker } from "../src/features/model2Run/protocol";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { resolveWorkload } from "@infraforge/domain/workload";
import { RailConnection } from "../src/features/canvas/components/RailConnection";

afterEach(()=>{useCanvasStore.getState().clearCanvas();useCanvasStore.setState({liveLocked:false,isDeploying:false});useSimulationStore.getState().reset();});
const db: Resource={id:"db",type:"Database",x:0,y:0};
const fw: Resource={id:"fw",type:"Firewall",x:0,y:0,firewallSettings:{version:1,default:"deny",rules:[{id:"block-db",priority:0,direction:"ingress",source:"any",destination:"db",fromPort:5432,toPort:5432,action:"deny"}]}};

test("listener and policy inspectors explain opt-in, empty lists, rule order, validation and run lock",()=>{
  useCanvasStore.setState({resources:[db,fw]});
  const absent=renderToStaticMarkup(<SecuritySection resource={db} disabled />);
  expect(absent).toContain("Listeners are inferred");expect(absent).toContain("Security measurements: Unknown");
  const explicit=renderToStaticMarkup(<SecuritySection resource={{...db,listenerSettings:{version:1,ports:[]}}} disabled />);
  expect(explicit).toContain("Leave empty for no listener");expect(explicit).toContain("Apply ports");expect(explicit).toContain("disabled");
  const policy=renderToStaticMarkup(<SecuritySection resource={fw} disabled />);
  for(const text of ["priority then rule ID","Both egress and ingress","Existing admitted connections","Educational TCP policy model","block-db","disabled"])expect(policy).toContain(text);
  const bad=structuredClone(fw);bad.firewallSettings!.rules[0]!.fromPort=65536;
  expect(renderToStaticMarkup(<SecuritySection resource={bad} disabled />)).toContain("port range must be ordered");
  expect(policy).not.toContain("[object Object]");
});

test("security settings undo, redo and respect deployment/run locks without injecting defaults",()=>{
  useCanvasStore.setState({resources:[db,fw],liveLocked:false,isDeploying:false});
  updateResource("db",{listenerSettings:{version:1,ports:[]}});updateResource("fw",{firewallSettings:{version:1,default:"allow",rules:[]}});
  const changed=structuredClone(useCanvasStore.getState().resources);
  undo();expect(useCanvasStore.getState().resources[1]!.firewallSettings).toEqual(fw.firewallSettings);
  undo();expect(useCanvasStore.getState().resources[0]!.listenerSettings).toBeUndefined();
  redo();redo();expect(useCanvasStore.getState().resources).toEqual(changed);
  for(const locks of [{liveLocked:true,isDeploying:false},{liveLocked:false,isDeploying:true}]){
    useCanvasStore.setState(locks);updateResource("db",{listenerSettings:undefined});expect(useCanvasStore.getState().resources).toEqual(changed);
  }
});

test("connection inspector names actual denial and observed zero; omitted readings stay Unknown",()=>{
  const edge={path:"app-db:app:db",source:"app",target:"db",admitted:0,denied:3,noListener:0,policyDenied:{"fw:ingress:block-db":3},backendDeliveries:0,lastDenial:{connectionId:"connection-7",source:"app",target:"db",port:5432,reason:"policy-denied:fw:ingress:block-db",generation:1}};
  const security={version:1 as const,evidence:"complete" as const,edges:[edge]};
  useCanvasStore.setState({resources:[db,{id:"app",type:"Virtual Machine",x:0,y:0}],connectionLines:[{id:"app-db",sourceId:"app",targetId:"db",sourceType:"Virtual Machine",targetType:"Database",port:5432}]});
  useSimulationStore.setState({metrics:{db:{cpu:null,memory:null,health:ResourceHealth.FAILED,security}}});
  const html=renderToStaticMarkup(<SecurityReadings metrics={security} />);
  for(const text of ["connection-7","db:5432","policy-denied:fw:ingress:block-db","backend deliveries 0"])expect(html).toContain(text);
  const omitted=renderToStaticMarkup(<SecurityReadings metrics={{...security,evidence:"omitted",omitted:7,edges:[{...edge,lastDenial:undefined}]}} />);
  expect(omitted).toContain("backend deliveries 0");expect(omitted).toContain("denied opens 3");expect(omitted).toContain("7 rows");expect(omitted).toContain("connection details: Unknown");expect(omitted).not.toContain("connection-7");
});

test("canvas rail labels the observed denial on its connection",()=>{
  const html=renderToStaticMarkup(<svg><RailConnection source={{x:0,y:0}} target={{x:500,y:0}} port={5432} nodeWidth={100} sourceHeight={100} targetHeight={100} securityLabel="policy-denied:fw:ingress:block-db" label="Connection c7 denied" onSelect={()=>{}} /></svg>);
  expect(html).toContain(":5432 policy-denied:fw:ingress:block-db");expect(html).toContain("Connection c7 denied");
});

for(const denied of [false,true])test(`production browser host matches serialized server replay twice with security settings; denied=${denied}`,()=>{
  const resources:Resource[]=[{id:"app",type:"Virtual Machine",x:0,y:0},db,fw];
  if(!denied){resources[1]={...db,listenerSettings:{version:1,ports:[5432]}};resources[2]={...fw,firewallSettings:{version:1,default:"allow",rules:[]}};}
  const input={resources,connectionLines:[{id:"app-db",sourceId:"app",targetId:"db",sourceType:"Virtual Machine",targetType:"Database",port:5432},{id:"fw-db",sourceId:"fw",targetId:"db",sourceType:"Firewall",targetType:"Database",port:5432}],workloadProfile:resolveWorkload({targetThroughput:600,throughputUnit:"per-minute",trafficShape:"steady",readWriteRatio:1,payloadSize:"light"}),seed:"security-parity"};
  const messages:FromWorker[]=[],queue:Array<()=>void>=[];
  const host=createRunHost(m=>messages.push(structuredClone(m)),{set:run=>{queue.push(run);return run;},clear:()=>{queue.length=0;}});
  host.handle({type:"start",start:{input,horizonSeconds:3,stopAtSecond:3,speed:1}});
  while(queue.length)queue.shift()!();
  expect(messages.filter(m=>m.type === "error")).toEqual([]);
  const seconds=messages.filter(m=>m.type === "second");expect(seconds).toHaveLength(3);
  for(let replay=0;replay<2;replay++){
    const server=createModel2Run(JSON.parse(JSON.stringify(input)),3);
    for(let i=0;i<3;i++){server.advance();expect(server.view()).toEqual(seconds[i]!.view);}
    expect(server.evidence()).toEqual(host.evidence()!);
    expect(server.view().metrics.db!.security!.edges[0]!.backendDeliveries === 0).toBe(denied);
  }
});


test("invalid security commits never enter the design or undo history",()=>{
  useCanvasStore.setState({resources:[db,fw]});
  for(const patch of [{priority:70000},{fromPort:NaN},{fromPort:6000,toPort:5000}]){
    updateResource("fw",{firewallSettings:{...fw.firewallSettings!,rules:[{...fw.firewallSettings!.rules[0]!,...patch}]}});
    expect(useCanvasStore.getState().resources).toEqual([db,fw]);
    expect(useCanvasStore.getState().undoStack).toHaveLength(0);
  }
  updateResource("db",{listenerSettings:{version:1,ports:[0]}});
  expect(useCanvasStore.getState().resources).toEqual([db,fw]);
});
