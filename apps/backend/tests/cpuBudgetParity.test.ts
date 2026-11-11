import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildRunReport } from "../reports/report";
import { cpuBudgetLabFixture } from "./cpuBudgetLab.fixture";

test("all CPU budget variants match browser target and two server replays at every captured second", async()=>{
  const entry=resolve(import.meta.dir,`../../../.cache/cpu-budget-${process.pid}.ts`),out=entry.replace(/\.ts$/,".mjs");
  await mkdir(dirname(entry),{recursive:true});
  try {
    await writeFile(entry,'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n',"utf8");
    const build=Bun.spawn([process.execPath,"--no-env-file","build",entry,"--target=browser","--outfile",out],{stdout:"ignore",stderr:"pipe"});
    const diagnostics=await new Response(build.stderr).text();if(await build.exited!==0)throw Error(diagnostics);
    const module=await import(pathToFileURL(out).href);
    const browserRun:typeof createModel2Run=module.createModel2Run,browserContract:typeof buildContractFromRunInputs=module.buildContractFromRunInputs;
    const {rows}=cpuBudgetLabFixture();
    for(const row of rows) {
      const input=readRunInputs(JSON.parse(JSON.stringify(row.runInputs)));
      expect(browserContract(input,6)).toEqual(buildContractFromRunInputs(input,6));
      const browser=browserRun(input,6),server=createModel2Engine(input,6),repeat=createModel2Engine(input,6);
      expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
      for(let second=1;second<=6;second++) {
        for(const run of [browser,server,repeat])run.advance();
        expect(browser.view()).toEqual(server.view());expect(browser.evidence()).toEqual(server.evidence());
        expect(repeat.view()).toEqual(server.view());expect(repeat.evidence()).toEqual(server.evidence());
      }
      const report=buildRunReport(row);
      expect(report.terminal!.traffic).toEqual(browser.view().traffic);
      expect(report.terminal!.resources[0]!.cpu).toBe(browser.view().metrics.app!.cpu!);
    }
    console.info("cpu-budget-parity",JSON.stringify({variants:3,ticksPerVariant:6,independentServerReplays:2}));
  } finally {for(const path of [entry,out])if(await Bun.file(path).exists())await unlink(path);}
},120000);
