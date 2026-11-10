import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { recordedScenario, verifiedScenario } from "../challenges/scenario";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildRunReport } from "../reports/report";
import { dnsPublicationLabFixture } from "./dnsPublicationLab.fixture";
import { dnsSnapshot } from "../simulator/dnsSnapshot";

test("all DNS publication variants replay deterministically in browser target and server at every incident boundary", async () => {
  const entry=resolve(import.meta.dir,`../../../.cache/dns-publication-${process.pid}.ts`), out=entry.replace(/\.ts$/,".mjs");
  await mkdir(dirname(entry),{recursive:true});
  try {
    await writeFile(entry,'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n',"utf8");
    const build=Bun.spawn([process.execPath,"--no-env-file","build",entry,"--target=browser","--outfile",out],{stdout:"ignore",stderr:"pipe"});
    const diagnostics=await new Response(build.stderr).text();if(await build.exited!==0) throw Error(diagnostics);
    const module=await import(pathToFileURL(out).href);
    const browserRun:typeof createModel2Run=module.createModel2Run, browserContract:typeof buildContractFromRunInputs=module.buildContractFromRunInputs;
    const {d, designs, rows}=dnsPublicationLabFixture();
    for (const [i, design] of designs.entries()) {
      const input=readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(design,d.workload,challengeSeed(d)))));
      const plan=recordedScenario(d,input)!, serverPlan=verifiedScenario(JSON.parse(JSON.stringify(plan)),d,input);
      expect(browserContract(input,8)).toEqual(buildContractFromRunInputs(input,8));
      const browser=browserRun(input,8), server=createModel2Engine(input,8), repeat=createModel2Engine(input,8);
      for(let second=1;second<=8;second++) {
        for(const run of [browser,server,repeat])run.advance();
        expect(browser.view()).toEqual(server.view());expect(browser.evidence()).toEqual(server.evidence());
        expect(repeat.view()).toEqual(server.view());expect(repeat.evidence()).toEqual(server.evidence());
        const raw=server.evidence(), authority=raw.systems.authorities[0]!, p=dnsSnapshot(raw).publication!;
        expect(p.publishedAtUs).toBe(second<=2?null:2_000_001);
        expect(p.currentRecord?.generation??null).toBe(second<=2?null:2);
        expect(authority.records.length).toBe(second<=2?0:1);
        expect(p.unresolvedConnections).toBe(raw.counts.rejected);
        for(const step of plan.steps.filter(s=>s.atSecond===second))browser.apply({kind:"intervention",parameters:step.request});
        for(const step of serverPlan.steps.filter(s=>s.atSecond===second))for(const run of [server,repeat])run.apply({kind:"intervention",parameters:step.request});
        // Applying a due step schedules the microsecond boundary; its next-tick effects must agree too.
        expect(browser.view()).toEqual(server.view());expect(browser.evidence()).toEqual(server.evidence());
      }
      const report=buildRunReport(rows[i]!);
      expect(report.terminal!.traffic).toEqual(browser.view().traffic);
      expect(report.terminal!.dnsEvidence).toEqual(dnsSnapshot(browser.evidence()));
    }
    console.info("dns-publication-parity", JSON.stringify({variants:3,ticksPerVariant:8,independentServerReplays:2}));
  } finally {for(const path of [entry,out])if(await Bun.file(path).exists())await unlink(path);}
},120000);
