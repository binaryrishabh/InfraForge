import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bufferSetup } from "./monitoringBuffer.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";

test("browser compiler and runtime preserve backend outage, slow ambiguous delivery and capacity evidence", async () => {
  const entry = resolve(import.meta.dir, `../../../.cache/monitor-buffer-product-${process.pid}.ts`), output = entry.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entry), { recursive: true });
  try {
    await writeFile(entry, 'export { compileProduct } from "../packages/simulation/src/model2/product/compiler";\nexport { createProductModel2 } from "../packages/simulation/src/model2/product/run";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entry, "--target=browser", "--outfile", output], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const module = await import(pathToFileURL(output).href), browserCompile: typeof compileProduct = module.compileProduct, browserRun: typeof createProductModel2 = module.createProductModel2;
    let cases = 0;
    for (const mode of ["backend-outage", "slow-export", "backend-full", "multiple"] as const) for (const attempts of [1, 3]) {
      const f = bufferSetup(mode, { version: 2, bufferSamples: 4, batchSamples: 2, exportAttempts: attempts, collectionIntervalSeconds: 1, exportIntervalSeconds: 3 });
      const compiled = browserCompile(f.saved, f.contract); expect(compiled).toEqual(compileProduct(f.saved, f.contract));
      if (!compiled.ok) throw Error("Browser compile refused");
      const browser = browserRun(compiled.value);
      for (let second = 1; second <= 65; second++) {
        browser.advanceTo(second * 1000000); f.runtime.advanceTo(second * 1000000);
        expect(browser.evidence()).toEqual(f.runtime.evidence());
      }
      cases++;
    }
    console.info("monitor-buffer-compiled-browser-server-parity", JSON.stringify({ cases, simulatedSecondsPerCase: 65 }));
  } finally { for (const path of [entry, output]) if (await Bun.file(path).exists()) await unlink(path); }
});
