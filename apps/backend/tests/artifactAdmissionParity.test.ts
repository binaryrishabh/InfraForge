import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildRunReport } from "../reports/report";
import { classifyComparison } from "../comparison/classify";
import { artifactAdmissionLabFixture } from "./artifactAdmissionLab.fixture";

test("all artifact admission variants match browser-target and two independent server replays at every tick", async () => {
  const entry = resolve(import.meta.dir, `../../../.cache/artifact-admission-${process.pid}.ts`), out = entry.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entry), {recursive: true});
  try {
    await writeFile(entry, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entry, "--target=browser", "--outfile", out], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const module = await import(pathToFileURL(out).href);
    const browserRun: typeof createModel2Run = module.createModel2Run, browserContract: typeof buildContractFromRunInputs = module.buildContractFromRunInputs;
    const {d, designs, rows} = artifactAdmissionLabFixture();
    for (const [i, design] of designs.entries()) {
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(design, d.workload, challengeSeed(d)))));
      expect(browserContract(input, 20)).toEqual(buildContractFromRunInputs(input, 20));
      const browser = browserRun(input, 20), server = createModel2Engine(input, 20), repeat = createModel2Engine(input, 20);
      expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
      for (let second = 1; second <= 20; second++) {
        for (const run of [browser, server, repeat]) run.advance();
        expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence());
        expect(repeat.view()).toEqual(server.view()); expect(repeat.evidence()).toEqual(server.evidence());
        const m = server.view().metrics.app!.startup!, cold = m.clients![1]!.replicas![0]!;
        const replica = m.controllers![0]!.replicas![1]!;
        if (i === 1 && second === 12) {
          expect(cold.artifactReadyAtUs).toBe(11001071); expect(replica).toMatchObject({state: "starting", listenerReadyAtUs: null, endpointReady: false});
        }
        if (i !== 1 && second >= 11) {
          expect(cold.artifactReadyAtUs).toBeNull(); expect(replica.listenerReadyAtUs).toBeNull();
          expect(replica.endpointReady).toBe(false);
        }
      }
      const raw = server.evidence(), backend = raw.network.loadBalancers[0]!.backends.find(r => r.id === "app#1")!;
      expect(backend.selected).toBe(i === 1 ? 700 : 0); // Real LB selections, separate from seven health probes.
      expect(raw.network.loadBalancers[0]!.completed).toBe(4000);
      const client = raw.systems.clients.find(c => c.id === "app#1/image")!;
      expect(client.cachedBytes).toBe(client.cache.reduce((n, b) => n + b.bytes, 0));
      expect(new Set(client.cache.map(b => b.digest)).size).toBe(client.cache.length);
      const report = buildRunReport(rows[i]!);
      expect(report.terminal!.resources.find(r => r.id === "app")!.startup).toEqual(browser.view().metrics.app!.startup);
      expect(report.terminal!.traffic).toEqual(browser.view().traffic);
    }
    console.info("artifact-admission-parity", JSON.stringify({variants: 3, initialAndSecondBoundariesPerVariant: 21, independentServerReplays: 2, newReplicaSelections: [0, 700, 0]}));
  } finally {for (const path of [entry, out]) if (await Bun.file(path).exists()) await unlink(path);}
}, 120000);

test("both controlled pairs retain one-change comparison, matched profiles, diagnosis and exact saved-report replay", () => {
  const {rows} = artifactAdmissionLabFixture();
  for (const i of [1, 2]) {
    const first = {...rows[0]!, createdAt: new Date(0)}, second = {...rows[i]!, createdAt: new Date(1), improvementSourceId: rows[0]!.id};
    const comparison = classifyComparison(first, second);
    expect(comparison.available).toBe(true);
    expect(comparison.designChangeReview).toMatchObject({classification: "one-change", count: 1});
    expect(comparison.starting.grade).toBe("one-change-design"); expect(comparison.lineage).toBe("source-and-improvement");
    expect(comparison.challengeConditions).toBe("same");
  }
});
