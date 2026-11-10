import {afterEach, expect, spyOn, test} from "bun:test";
import {resolve} from "node:path";
import {Children, isValidElement, type ReactElement, type ReactNode} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {MemoryRouter} from "react-router-dom";
import type {Resource} from "@infraforge/domain/resource";
import type {RunReport} from "@infraforge/contracts/reports";
import {DatabaseReplicationSection} from "../src/features/canvas/components/inspector/DatabaseReplicationSection";
import {DatabaseReplicationReadings} from "../src/features/live/DatabaseReplicationReadings";
import {ReportMeasurements} from "../src/features/reports/components/ReportMeasurements";
import {ChallengeDebrief} from "../src/features/challenges/components/ChallengeDebrief";
import {useCanvasStore} from "../src/features/canvas/store/canvasStore";
import {updateResource} from "../src/features/canvas/actions";
import {undo, redo} from "../src/features/canvas/history";
import {saveDesign} from "../src/features/canvas/designActions";
import {installDesign} from "../src/features/canvas/designLoader";
import {useAuthStore} from "../src/features/auth/store/auth.store";
import {http} from "../src/client/httpClient";

const db:Resource={id:"db",type:"Database",x:320,y:0,databaseReplication:{version:1,enabled:true,replicationDelayMs:1200,readPolicy:"primary"}};
afterEach(()=>{useCanvasStore.getState().clearCanvas();useAuthStore.setState({user:null,status:"guest"});});

function fieldByLabel(node:ReactNode,label:string):ReactElement|undefined {
  for(const child of Children.toArray(node))if(isValidElement<{children?:ReactNode;label?:string}>(child)) {
    if(child.props.label===label)return child;
    const found=fieldByLabel(child.props.children,label);if(found)return found;
  }
}
function editPolicy(value:string,disabled=false) {
  const tree=DatabaseReplicationSection({resource:useCanvasStore.getState().resources[0]!,disabled});
  const field=fieldByLabel(tree.props.children,"Old-primary catch-up") as ReactElement<{children:(ids:{id:string;describedBy:string})=>ReactElement<{onChange:(e:{target:{value:string}})=>void}>}>;
  field.props.children({id:"rejoin-test",describedBy:"rejoin-help"}).props.onChange({target:{value}});
}

test("real native catch-up select changes only saved rejoin intent, refuses unsupported choices and respects locks",()=>{
  const html=renderToStaticMarkup(<DatabaseReplicationSection resource={db} disabled={false}/>);
  const label=/<label for="([^"]+)"[^>]*>Old-primary catch-up<\/label>/.exec(html)!;
  expect(html).toContain(`<select id="${label[1]}"`); // Native keyboard-operated select with its associated label.
  expect(html).toContain('value="snapshot-replay/1"');expect(html).toContain("Snapshot and ordered replay");
  expect(html).toContain("returned primary stays fenced");
  useCanvasStore.getState().loadLayout([db],[],"design","Redundancy");
  editPolicy("snapshot-replay/1");
  expect(useCanvasStore.getState().resources[0]!.databaseReplication).toEqual({...db.databaseReplication!,rejoin:"snapshot-replay/1"});
  undo();expect(useCanvasStore.getState().resources[0]!.databaseReplication).not.toHaveProperty("rejoin");
  redo();expect(useCanvasStore.getState().resources[0]!.databaseReplication!.rejoin).toBe("snapshot-replay/1");
  for(const value of ["rejoin-now","2","", "snapshot-replay/2"])editPolicy(value);
  editPolicy("off",true);
  expect(useCanvasStore.getState().resources[0]!.databaseReplication!.rejoin).toBe("snapshot-replay/1");
  for(const lock of ["liveLocked","isDeploying"] as const){
    useCanvasStore.setState({[lock]:true});editPolicy("off");
    expect(useCanvasStore.getState().resources[0]!.databaseReplication!.rejoin).toBe("snapshot-replay/1");
    useCanvasStore.setState({[lock]:false});
  }
  for(const value of [0,-1,1.5,60001,NaN,Infinity]){
    updateResource("db",{databaseReplication:{...useCanvasStore.getState().resources[0]!.databaseReplication!,replicationDelayMs:value}});
    expect(useCanvasStore.getState().resources[0]!.databaseReplication!.replicationDelayMs).toBe(1200);
  }
  editPolicy("off");expect(useCanvasStore.getState().resources[0]!.databaseReplication).toEqual(db.databaseReplication);
  expect(useCanvasStore.getState().resources[0]!.databaseReplication).not.toHaveProperty("rejoin");
});

test("catch-up intent persists through actual save payload and install, including optional omission",async()=>{
  useAuthStore.setState({user:{id:"owner",name:"Owner",username:null,email:"owner@infraforge.test",emailVerified:true,createdAt:new Date(0).toISOString()},status:"authenticated"});
  for(const enabled of [true,false]){
    useCanvasStore.getState().loadLayout([db],[],"design","Redundancy");if(enabled)editPolicy("snapshot-replay/1");
    const saved=JSON.parse(JSON.stringify({id:"design",name:"Redundancy",layout:{resources:useCanvasStore.getState().resources,connectionLines:[],layoutVersion:3}}));
    const write=spyOn(http,"put").mockResolvedValue({data:{updatedInfrastructure:saved}});
    try{
      await saveDesign();expect(write).toHaveBeenCalledTimes(1);
      const sent=JSON.parse(JSON.stringify(write.mock.calls[0]![1]));
      expect(sent.layout.resources[0].databaseReplication).toEqual(saved.layout.resources[0].databaseReplication);
      if(!enabled)expect(sent.layout.resources[0].databaseReplication).not.toHaveProperty("rejoin");
      useCanvasStore.getState().clearCanvas();installDesign(saved);
      expect(useCanvasStore.getState().resources[0]!.databaseReplication).toEqual(saved.layout.resources[0].databaseReplication);
    }finally{write.mockRestore();}
  }
});

test("real saved reports render terminal redundancy, backlog and historical loss through generic requirements",async()=>{
  const child=Bun.spawn([process.execPath,"--no-env-file",resolve(import.meta.dir,"../../backend/tests/databaseRedundancyReport.fixture.ts")],{stdout:"pipe",stderr:"pipe"});
  const [out,err]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text()]);
  expect(await child.exited,err).toBe(0);
  const reports=JSON.parse(out) as RunReport[];
  for(const [i,report] of reports.entries()){
    const html=renderToStaticMarkup(<ReportMeasurements report={report} number={3}/>);
    for(const label of ["Database incident record","Current writer","Original primary role","Replica role","Unreplicated commits lost at promotion"] )expect(html).toContain(label);
    const result=renderToStaticMarkup(<MemoryRouter><ChallengeDebrief evaluation={report.challenge!} brief={null}/></MemoryRouter>);
    expect(result).toContain("At second 64, returned replica caught up with exactly one promoted writer");
    expect(result).toContain(i===1?"Redundancy restored at this sample":"Redundancy");
    if(i){for(const label of ["Pending catch-up operations","Pending catch-up batches (including snapshot)","Replica eligible at this sample"])expect(html).toContain(label);}
  }
  const m=reports[1]!.terminal!.resources.find(r=>r.id==="db")!.databaseReplication!;
  expect(m.rejoin).toMatchObject({pendingOperations:0,eligible:true});expect(m.lostOperations).toBe(1);
  const joined=renderToStaticMarkup(<DatabaseReplicationReadings metrics={{databaseReplication:m}}/>);
  expect(joined).toContain("<dt>Pending catch-up operations</dt><dd>0</dd>");
  expect(joined).toContain("<dt>Unreplicated commits lost at promotion</dt><dd>1</dd>");
  const unknown=structuredClone(m);unknown.rejoin!.pendingOperations=null;unknown.rejoin!.eligible=null;
  const missing=renderToStaticMarkup(<DatabaseReplicationReadings metrics={{databaseReplication:unknown}}/>);
  expect(missing).toContain("<dt>Pending catch-up operations</dt><dd>Unknown</dd>");
  expect(missing).toContain("<dt>Replica eligible at this sample</dt><dd>Unknown</dd>");
});
