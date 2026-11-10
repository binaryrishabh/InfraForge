import { afterEach, expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { Resource } from "@infraforge/domain/resource";
import type { RunReport } from "@infraforge/contracts/reports";
import { LEARNING_REPORT_MEASUREMENTS } from "@infraforge/contracts/learning";
import { DnsCacheSection } from "../src/features/canvas/components/inspector/DnsCacheSection";
import { DnsPublicationReadings } from "../src/features/reports/components/DnsPublicationReadings";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { lessonRunMeasurements } from "../src/features/learning/runSummaryData";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";
const dns:Resource={id:"dns",type:"DNS",x:0,y:0,dnsPublication:{version:1,initialRecord:"absent"},dnsCachePolicy:{version:1,maxTtlSeconds:60}};
afterEach(()=>{useCanvasStore.getState().clearCanvas();useAuthStore.setState({user:null,status:"guest"});});
test("the real TTL control preserves publication intent through save and reload",async()=>{
  useAuthStore.setState({user:{id:"owner",name:"Owner",username:null,email:"owner@infraforge.test",emailVerified:true,createdAt:new Date(0).toISOString()},status:"authenticated"});
  useCanvasStore.getState().loadLayout([dns],[],"layout","DNS publication");
  const tree=DnsCacheSection({resource:useCanvasStore.getState().resources[0]!,disabled:false});
  const field=tree.props.children as ReactElement<{children:(ids:{id:string})=>ReactElement<{onChange:(e:{target:{value:string}})=>void}>}>;
  field.props.children({id:"ttl-test"}).props.onChange({target:{value:"1"}});
  expect(useCanvasStore.getState().resources[0]).toEqual({...dns,dnsCachePolicy:{version:1,maxTtlSeconds:1}});
  const saved=spyOn(http,"put").mockResolvedValue({data:{updatedInfrastructure:{id:"layout",name:"DNS publication"}}});
  try {
    await saveDesign();const payload=JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as {layout:{resources:Resource[]}};
    expect(payload.layout.resources[0]!.dnsPublication).toEqual(dns.dnsPublication);
    useCanvasStore.getState().clearCanvas();useCanvasStore.getState().loadLayout(payload.layout.resources,[],"layout","DNS publication");
    expect(useCanvasStore.getState().resources[0]!.dnsCachePolicy!.maxTtlSeconds).toBe(1);
    expect(useCanvasStore.getState().resources[0]!.dnsPublication).toEqual(dns.dnsPublication);
  } finally {saved.mockRestore();}
});
test("saved DNS publication evidence renders the actual authority, cache and caller populations",async()=>{
  const child=Bun.spawn([process.execPath,"--no-env-file",resolve(import.meta.dir,"../../backend/tests/dnsPublicationReport.fixture.ts")],{stdout:"pipe",stderr:"pipe"});
  const [out,err]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text()]);expect(await child.exited,err).toBe(0);
  const reports=JSON.parse(out) as RunReport[];
  const labels=Object.entries(LEARNING_REPORT_MEASUREMENTS).filter(([,d])=>d.path.startsWith("dnsEvidence.publication."));
  for(const report of reports) {
    const p=report.terminal!.dnsEvidence!.publication!, html=renderToStaticMarkup(<ReportMeasurements report={report} number={3}/>);
    for(const [label,d] of labels) {
      const path=d.path.split(".").slice(2);let value:unknown=p;
      for(const k of path)value=value&&typeof value==="object"?(value as Record<string,unknown>)[k]:undefined;
      expect(html).toContain(`<dt>${label}</dt><dd>${value??"Unknown"}</dd>`);
      expect(lessonRunMeasurements(report,[label])[0]!.value).toContain(String(value));
    }
    expect(html).toContain("authority dns; resolver dns/resolver");expect(html).toContain("deterministic simulated microseconds");
    const missing=structuredClone(report);delete missing.terminal!.dnsEvidence!.publication;
    expect(lessonRunMeasurements(missing,["DNS: Published at"])[0]!.value).toBe("Unknown");
  }
  const p=reports[0]!.terminal!.dnsEvidence!.publication!;
  const unknown=renderToStaticMarkup(<DnsPublicationReadings publication={{...p,publishedAtUs:null,currentRecord:null,firstSuccessfulResolutionAtUs:null,updates:null,negativeCacheHits:null}}/>);
  expect(unknown).toContain("<dt>DNS: Published at</dt><dd>Unknown</dd>");
  expect(unknown).toContain("<dt>DNS: Negative cache hits</dt><dd>Unknown</dd>");
  expect(renderToStaticMarkup(<DnsPublicationReadings/>)).toBe("");
});
