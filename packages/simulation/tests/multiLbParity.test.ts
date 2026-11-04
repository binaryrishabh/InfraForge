import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createProductModel2 } from "../src/model2/product/run";
import { multiLbDesign, prepareMultiLb } from "./multiLb.fixture";

test("six nested LBs preserve per-LB accounting in browser-target and server execution", async () => {
  const browserPath = resolve(import.meta.dir, `../../../.cache/multi-lb-browser-${process.pid}.mjs`);
  await mkdir(dirname(browserPath), { recursive: true });
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../src/model2/product/run.ts"), "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text();
    if (await build.exited !== 0) throw Error(diagnostics);
    const createBrowserRuntime: typeof createProductModel2 = (await import(pathToFileURL(browserPath).href)).createProductModel2;
    const d = multiLbDesign(5, true); d.workload.targetThroughput = 1200;
    const slow = d.resources.find(r => r.id === "vm-0")!; slow.size = "small"; slow.vmCpuQuota = { version: 1, limitPercent: 1 };
    d.resources.find(r => r.id === "lb-0")!.lbAdmission = { version: 1, maxActive: 1, maxQueued: 2, queueWaitMs: 20 };
    const f = prepareMultiLb(d), browser = createBrowserRuntime(f.compiled);
    for (let second = 1; second <= 3; second++) {
      f.runtime.advanceTo(second * 1000000); browser.advanceTo(second * 1000000);
      expect(browser.evidence()).toEqual(f.runtime.evidence());
    }
    expect(browser.evidence().network.loadBalancers.find(lb => lb.id === "lb-0")!.accounting!.rejectedAtLb).toBeGreaterThan(0);
    expect(browser.evidence().network.loadBalancers).toHaveLength(6);
  } finally { if (await Bun.file(browserPath).exists()) await unlink(browserPath); }
});
