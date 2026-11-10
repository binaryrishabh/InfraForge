import { expect, test } from "bun:test";
import { interventionError } from "@infraforge/domain/resource";
import { buildContractFromRunInputs, compileProduct } from "@infraforge/simulation/internal-product";
import { compileScenario } from "@infraforge/simulation/model2-run";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { dnsSnapshot } from "../simulator/dnsSnapshot";
import { DnsEvidenceSchema } from "../reports/dnsSchema";
import { LayoutSchema } from "../zod_schemas/layout.schema";
import { dnsLayout, dnsWorkload } from "./dnsDepth.fixture";

const request = {interventionId: "dns-publish-entry", revision: 1, target: {resourceId: "dns"}, parameters: {}};
const scenario = {version: 1 as const, visibility: "revealed" as const, steps: [{id: "publish", atSecond: 2, request}]};
export function publicationLayout(ttl = 60) {
  const layout = dnsLayout(ttl); layout.resources[0]!.dnsPublication = {version: 1, initialRecord: "absent"}; return layout;
}
test("publication preserves cached NXDOMAIN, records real authority time, then expiry permits resolution", () => {
  const rows = [60,1].map(ttl => {
    const input = captureRunInputs(publicationLayout(ttl), dnsWorkload, "publication-proof");
    expect(compileScenario(scenario, input, 8)[0]).toMatchObject({atUs:2_000_001,endUs:null,resolvedTargets:["dns"],affectedPaths:["external-entry"]});
    const run = createModel2Engine(input,8), observations = [];
    expect(dnsSnapshot(run.evidence()).publication).toMatchObject({initialRecord:"absent",publishedAtUs:null,currentRecord:null,firstSuccessfulResolutionAtUs:null});
    for (let second=1;second<=8;second++) {
      run.advance();
      if(second===2) { expect(run.apply({kind:"intervention",parameters:request}).outcome.intervention).toMatchObject({atUs:2_000_001}); while(run.catchingUp)run.catchUp(10); expect(() => run.apply({kind:"intervention",parameters:request})).toThrow("only one DNS publication"); }
      const e=run.evidence(), before=JSON.stringify(e), saved=dnsSnapshot(e);
      expect(JSON.stringify(run.evidence())).toBe(before); expect(saved).toEqual(DnsEvidenceSchema.parse(JSON.parse(JSON.stringify(saved))));
      observations.push({raw:e,saved});
    }
    const three=observations[2]!;
    expect(three.saved.publication).toMatchObject({publishedAtUs:2_000_001,currentRecord:{generation:2},updates:1});
    if (ttl === 60) expect(three.saved.resolvers[0]!.cache[0]!.answer).toMatchObject({ok:false,reason:"nxdomain"});
    expect(observations[0]!.saved.resolvers[0]!.cache[0]!.answer).toMatchObject({ok:false,reason:"nxdomain"});
    expect(three.raw.systems.authorities[0]!.records[0]!.generation).toBe(2);
    expect(three.raw.systems.security.dnsFailed).toBe(three.raw.counts.rejected);
    expect(three.saved.publication!.firstSuccessfulResolutionAtUs).toBeNull();
    return observations[7]!;
  });
  expect(rows.map(r=>r.raw.counts.completed)).toEqual([5,10]);
  expect(rows.map(r=>r.raw.counts.rejected)).toEqual([11,6]);
  expect(rows[0]!.saved.publication!.negativeCacheHits).toBeGreaterThan(rows[1]!.saved.publication!.negativeCacheHits!);
  expect(rows[0]!.saved.publication!.firstSuccessfulResolutionAtUs).toBeGreaterThan(rows[1]!.saved.publication!.firstSuccessfulResolutionAtUs!);
  expect(rows[1]!.raw.systems.resolvers[0]!.expirations).toBeGreaterThan(0);
  console.info("dns-publication-calibration",JSON.stringify(rows.map(r=>({counts:r.raw.counts,publication:r.saved.publication}))));
});
test("saved publication and profiles refuse malformed, wrong owner and mismatched bindings", () => {
  for(const value of [null,{},[],{version:2,initialRecord:"absent"},{version:1,initialRecord:"present"},{version:1,initialRecord:"absent",name:"other"}]) {
    const layout=publicationLayout();Object.assign(layout.resources[0]!,{dnsPublication:value});expect(LayoutSchema.safeParse(layout).success).toBe(false);
  }
  const wrong=publicationLayout();wrong.resources[1]!.dnsPublication=wrong.resources[0]!.dnsPublication;expect(LayoutSchema.safeParse(wrong).success).toBe(false);
  expect(interventionError({...request,parameters:{name:"other.example"}})).toContain("INTERVENTION_PARAMETERS");
  expect(interventionError({...request,revision:2})).toContain("INTERVENTION_REVISION");
  const input=captureRunInputs(publicationLayout(),dnsWorkload,"refusals");
  expect(buildContractFromRunInputs({...input,adapterProfiles:input.adapterProfiles!.filter(p=>p!=="dns-publication/1")},8)).toHaveProperty("refused");
  const old=captureRunInputs(dnsLayout(60),dnsWorkload,"old");
  expect(buildContractFromRunInputs({...old,adapterProfiles:[...old.adapterProfiles!,"dns-publication/1"]},8)).toHaveProperty("refused");
  expect(()=>compileScenario(scenario,old,8)).toThrow();
  expect(()=>compileScenario({...scenario,steps:[...scenario.steps,{...scenario.steps[0]!,id:"twice",atSecond:3}]},input,8)).toThrow();
  expect(()=>compileScenario({...scenario,steps:[{...scenario.steps[0]!,request:{...request,target:{resourceId:"app"}}}]},input,8)).toThrow();
  const built=buildContractFromRunInputs(input,8);if("refused" in built)throw Error(built.refused.join());
  for(const change of [(c:typeof built.contract)=>{c.version=c.version.replace("dns-publication/1","dns-publication/10");},
    (c:typeof built.contract)=>{c.caller.security.dns!.routes.push({...c.caller.security.dns!.routes[0]!});},
    (c:typeof built.contract)=>{const a=c.nodes.dns!.resources[0]!.config;if(a.kind==="dns-authority")a.publication!.record.addresses=["10.0.0.99"];},
    (c:typeof built.contract)=>{c.caller.security.dns!.resolver="$app";}]) {
    const contract=structuredClone(built.contract);change(contract);
    expect(compileProduct({schema:"infraforge-saved-design/1",resources:input.resources,connections:input.connectionLines,workload:input.workloadProfile},contract).ok).toBe(false);
  }
  const unmarked=createModel2Engine(old,8);unmarked.advance();expect(dnsSnapshot(unmarked.evidence())).not.toHaveProperty("publication");
});

test("publication observations reject contradictions and keep unrecorded values Unknown", () => {
  const input=captureRunInputs(publicationLayout(),dnsWorkload,"evidence-refusals"),run=createModel2Engine(input,8);
  run.advance(); const raw=run.evidence(), saved=dnsSnapshot(raw);
  const missing=structuredClone(raw);delete missing.systems.resolvers[0]!.negativeHits;
  expect(dnsSnapshot(missing).publication!.negativeCacheHits).toBeNull();
  for(const mutate of [(e:typeof saved)=>{e.publication!.negativeCacheHits=-1;},
    (e:typeof saved)=>{e.publication!.publishedAtUs=2_000_001;},
    (e:typeof saved)=>{e.publication!.resolverId="unrelated";},
    (e:typeof saved)=>{e.publication!.firstSuccessfulResolutionAtUs=1;}]) {
    const bad=structuredClone(saved);mutate(bad);expect(DnsEvidenceSchema.safeParse(bad).success).toBe(false);
  }
});
