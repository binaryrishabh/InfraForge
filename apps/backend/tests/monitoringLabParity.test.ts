import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { challengeSeed } from "../challenges/registry";
import { monitoringLabFixture } from "./monitoringLab.fixture";

test("monitoring lab browser-target bundle and default server replay agree every second for all three variants", async () => {
  const entry=resolve(import.meta.dir,`../../../.cache/monitor-lab-${process.pid}.ts`), out=entry.replace(/\.ts$/,".mjs");
  await mkdir(dirname(entry),{recursive:true});
  try {
    await writeFile(entry,'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n',"utf8");
    const build=Bun.spawn([process.execPath,"--no-env-file","build",entry,"--target=browser","--outfile",out],{stdout:"ignore",stderr:"pipe"});
    const diagnostic=await new Response(build.stderr).text();if(await build.exited!==0) throw Error(diagnostic);
    const module=await import(pathToFileURL(out).href);
    const browserRun:typeof createModel2Run=module.createModel2Run, browserContract:typeof buildContractFromRunInputs=module.buildContractFromRunInputs;
    const {d,designs}=monitoringLabFixture();
    for(const design of designs) {
      const input=readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(design,d.workload,challengeSeed(d)))));
      expect(browserContract(input,90)).toEqual(buildContractFromRunInputs(input,90));
      const browser=browserRun(input,90),server=createModel2Engine(input,90);
      for(let second=1;second<=90;second++) {browser.advance();server.advance();expect(browser.view()).toEqual(server.view());expect(browser.evidence()).toEqual(server.evidence());}
    }
    console.info("monitoring-lab-browser-target-server-parity",JSON.stringify({cases:3,secondsPerCase:90}));
  } finally {for(const path of [entry,out]) if(await Bun.file(path).exists()) await unlink(path);}
}, 120000);
