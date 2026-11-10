import { afterEach, expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { Resource } from "@infraforge/domain/resource";
import type { RunReport } from "@infraforge/contracts/reports";
import { GatewayQuotaSection } from "../src/features/canvas/components/inspector/GatewayQuotaSection";
import { GatewayReadings } from "../src/features/live/GatewayReadings";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { lessonRunMeasurements } from "../src/features/learning/runSummaryData";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const gateway:Resource={id:"gateway",type:"API Gateway",x:0,y:0,gatewayQuota:{version:1,scope:"shared"},apiGateway:{version:1,routes:[
  {id:"read",edge:"reads",path:"/read",method:"GET",burstRequests:2,requestsPerSecond:10},
  {id:"write",edge:"writes",path:"/write",method:"POST",burstRequests:2,requestsPerSecond:10}]}};
afterEach(()=>{useCanvasStore.getState().clearCanvas();useAuthStore.setState({user:null,status:"guest"});});
test("the scope control changes only ownership and survives canvas save and reload",async()=>{
  useAuthStore.setState({user:{id:"owner",name:"Owner",username:null,email:"owner@infraforge.test",emailVerified:true,createdAt:new Date(0).toISOString()},status:"authenticated"});
  useCanvasStore.getState().loadLayout([gateway],[],"layout","Quota ownership");
  const tree=GatewayQuotaSection({resource:useCanvasStore.getState().resources[0]!,disabled:false});
  const label=tree.props.children[0] as ReactElement<{children:[string,ReactElement<{onChange:(e:{target:{value:string}})=>void}>]}>;
  label.props.children[1].props.onChange({target:{value:"per-route"}});
  expect(useCanvasStore.getState().resources[0]).toEqual({...gateway,gatewayQuota:{version:1,scope:"per-route"}});
  expect(renderToStaticMarkup(<GatewayQuotaSection resource={gateway} disabled/>)).toContain('aria-label="Quota scope" disabled=""');
  const saved=spyOn(http,"put").mockResolvedValue({data:{updatedInfrastructure:{id:"layout",name:"Quota ownership"}}});
  try {
    await saveDesign();const payload=JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as {layout:{resources:Resource[]}};
    useCanvasStore.getState().clearCanvas();useCanvasStore.getState().loadLayout(payload.layout.resources,[],"layout","Quota ownership");
    expect(useCanvasStore.getState().resources[0]!.gatewayQuota).toEqual({version:1,scope:"per-route"});
    expect(useCanvasStore.getState().resources[0]!.apiGateway).toEqual(gateway.apiGateway);
  } finally {saved.mockRestore();}
});
test("real saved quota reports show route outcomes, scope and Unknown historical observations",async()=>{
  const child=Bun.spawn([process.execPath,"--no-env-file",resolve(import.meta.dir,"../../backend/tests/gatewayQuotaReport.fixture.ts")],{stdout:"pipe",stderr:"pipe"});
  const [out,err]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text()]);expect(await child.exited,err).toBe(0);
  const reports=JSON.parse(out) as RunReport[];
  for(const [i,report] of reports.entries()) {
    const g=report.terminal!.resources.find(r=>r.id==="gateway")!.gateway!,html=renderToStaticMarkup(<ReportMeasurements report={report} number={3}/>);
    expect(html).toContain(`Quota scope: ${g.quota!.scope}`);
    expect(html).toContain(`<dt>Completed</dt><dd>${g.routes[1]!.outcomes!.completed}</dd>`);
    expect(html).toContain(`<dt>Throttled</dt><dd>${g.routes[1]!.rejected}</dd>`);
    expect(html).toContain(i===1?"Each route owns its own equal budget":"do not add them");
    expect(lessonRunMeasurements(report,["Quota scope"])[0]!.value).toContain(g.quota!.scope);
    expect(lessonRunMeasurements(report,["Gateway route: Completed"])[0]!.value).toContain(i===1?"61":"1");
    const missing=structuredClone(report);delete missing.terminal!.resources.find(r=>r.id==="gateway")!.gateway!.quota;
    expect(lessonRunMeasurements(missing,["Quota scope"])[0]!.value).toBe("gateway: Unknown");
    const unknown=structuredClone(g);delete unknown.quota;delete unknown.routes[1]!.outcomes;
    const historical=renderToStaticMarkup(<GatewayReadings metrics={unknown}/>);
    expect(historical).toContain("Unknown (not recorded)");expect(historical).toContain("<dt>Completed</dt><dd>Unknown</dd>");
  }
  expect(renderToStaticMarkup(<GatewayReadings/>)).toContain("Route budgets: Unknown");
});
