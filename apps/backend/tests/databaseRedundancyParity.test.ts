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
import { classifyComparison } from "../comparison/classify";
import { redundancyFixture } from "./databaseRedundancy.fixture";

test("all redundancy variants replay deterministically in browser target and server at every incident boundary", async () => {
  const entry=resolve(import.meta.dir,`../../../.cache/redundancy-${process.pid}.ts`), out=entry.replace(/\.ts$/,".mjs");
  await mkdir(dirname(entry),{recursive:true});
  try {
    await writeFile(entry,'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n',"utf8");
    const build=Bun.spawn([process.execPath,"--no-env-file","build",entry,"--target=browser","--outfile",out],{stdout:"ignore",stderr:"pipe"});
    const diagnostics=await new Response(build.stderr).text();if(await build.exited!==0) throw Error(diagnostics);
    const module=await import(pathToFileURL(out).href);
    const browserRun:typeof createModel2Run=module.createModel2Run, browserContract:typeof buildContractFromRunInputs=module.buildContractFromRunInputs;
    const {d, designs, rows}=redundancyFixture();
    for (const [i, design] of designs.entries()) {
      const input=readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(design,d.workload,challengeSeed(d)))));
      const plan=recordedScenario(d,input)!, serverPlan=verifiedScenario(JSON.parse(JSON.stringify(plan)),d,input);
      expect(browserContract(input,64)).toEqual(buildContractFromRunInputs(input,64));
      const browser=browserRun(input,64), server=createModel2Engine(input,64), repeat=createModel2Engine(input,64);
      for(let second=1;second<=64;second++) {
        for(const run of [browser,server,repeat])run.advance();
        expect(browser.view()).toEqual(server.view());expect(browser.evidence()).toEqual(server.evidence());
        expect(repeat.view()).toEqual(server.view());expect(repeat.evidence()).toEqual(server.evidence());
        const m=server.view().metrics.db!.databaseReplication!;
        // Authority has one writer role throughout; the explicit outage has zero available writers.
        expect(Number(m.primaryRole==="writer")+Number(m.replicaRole==="writer")).toBe(1);
        expect(m.currentWriter).toBe(second<=20?"primary":second===21?"none":"replica");
        for(const step of plan.steps.filter(s=>s.atSecond===second))browser.apply({kind:"intervention",parameters:step.request});
        for(const step of serverPlan.steps.filter(s=>s.atSecond===second))for(const run of [server,repeat])run.apply({kind:"intervention",parameters:step.request});
        // Applying a due step schedules the microsecond boundary; its next-tick effects must agree too.
        expect(browser.view()).toEqual(server.view());expect(browser.evidence()).toEqual(server.evidence());
      }
      const report=buildRunReport(rows[i]!);
      expect(report.terminal!.traffic).toEqual(browser.view().traffic);
      expect(report.terminal!.resources.find(r=>r.id==="db")!.databaseReplication).toEqual(browser.view().metrics.db!.databaseReplication);
    }
    console.info("redundancy-parity", JSON.stringify({variants:3,ticksPerVariant:64,independentServerReplays:2}));
  } finally {for(const path of [entry,out])if(await Bun.file(path).exists())await unlink(path);}
},120000);

test("two-run compare retains one-change review and honestly marks the added adapter profile", () => {
  const {rows}=redundancyFixture();
  for(const [a,b] of [[0,1],[1,2]] as const) {
    const first={...rows[a]!,createdAt:new Date(0)}, second={...rows[b]!,createdAt:new Date(1),improvementSourceId:rows[a]!.id};
    const comparison=classifyComparison(first,second);
    expect(comparison.available).toBe(true);
    expect(comparison.designChangeReview).toMatchObject({classification:"one-change",count:1});
    expect(comparison.lineage).toBe("source-and-improvement");
    if(a===0) {
      expect(comparison.starting.grade).toBe("side-by-side-only");
      expect(comparison.starting.compatibilityReason).toContain("adapter profile selections differ");
    } else expect(comparison.starting.grade).toBe("one-change-design");
  }
});
