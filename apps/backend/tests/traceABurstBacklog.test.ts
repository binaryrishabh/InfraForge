import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { challengeSeed, specHash } from "../challenges/registry";
import { buildRunReport } from "../reports/report";
import { readFileSync } from "node:fs";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { reviewDesignChanges } from "../challenges/designChanges";
import { preflight } from "../challenges/preflight";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

const ID = "trace-a-burst-backlog";
const edit = (fn: (s: ChallengeStarter) => void) => { const s = structuredClone(definition(ID).starter!); fn(s); return s; };
function variants() {
  const d = definition(ID), starter = d.starter!;
  const bigWorker = edit(s => { s.resources.find(r => r.id === "worker")!.size = "medium"; });
  const parallel = edit(s => { const w = s.resources.find(r => r.id === "worker")!.asyncWorker!; w.concurrency = 16; w.prefetch = 16; });
  return { d, designs: [starter, REFERENCE[ID]!, bigWorker, parallel] };
}

test("trace-a-burst-backlog: capacity alone keeps the burst's events; a bigger worker or more parallel jobs do not; reports round-trip", () => {
  const { d, designs } = variants();
  expect(validateInfrastructureName(d.title)).toBeNull();
  expect(specHash(d)).toBe(/"trace-a-burst-backlog@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!);
  for (const design of designs) expect(preflight(d, design).errors).toEqual([]);
  const inputs = designs.map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
  for (const i of [1, 2, 3]) expect(reviewDesignChanges(inputs[0]!, inputs[i]!)).toMatchObject({ classification: "one-change", count: 1 });
  const rows = designs.map(s => attemptRow(d, s, answers(d, { health: "healthy" }))), reports = rows.map(r => buildRunReport(r));
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met", "not-met"]);
  expect(reports.map(r => r.terminal!.traffic!.wholeRun!.failed)).toEqual([223, 0, 63, 231]);
  const q = reports.map(r => r.terminal!.resources.find(x => x.id === "queue")!.queueWork!);
  expect(q.map(x => [x.originals, x.acknowledged])).toEqual([[1137, 1137], [1360, 1360], [1297, 1297], [1129, 1129]]);
  for (const [i, row] of rows.entries()) {
    const saved = { ...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot)) };
    expect(buildRunReport(saved).terminal).toEqual(reports[i]!.terminal);
    expect(buildRunReport(saved).challenge).toEqual(reports[i]!.challenge);
  }
});

test("trace-a-burst-backlog: browser-target bundle and default server replay agree every second for all variants", async () => {
  const entry = resolve(import.meta.dir, `../../../.cache/burst-backlog-${process.pid}.ts`), out = entry.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entry), { recursive: true });
  try {
    await writeFile(entry, 'export { createModel2Run } from "../packages/simulation/src/model2Run";\nexport { buildContractFromRunInputs } from "../packages/simulation/src/model2/product/runContract";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entry, "--target=browser", "--outfile", out], { stdout: "ignore", stderr: "pipe" });
    const diagnostic = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostic);
    const module = await import(pathToFileURL(out).href);
    const browserRun: typeof createModel2Run = module.createModel2Run, browserContract: typeof buildContractFromRunInputs = module.buildContractFromRunInputs;
    const { d, designs } = variants();
    for (const design of designs) {
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(design, d.workload, challengeSeed(d)))));
      
      expect(browserContract(input, 240)).toEqual(buildContractFromRunInputs(input, 240));
      const browser = browserRun(input, 240), server = createModel2Engine(input, 240);
      for (let second = 1; second <= 240; second++) { browser.advance(); server.advance(); expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence()); }
    }
    console.info("burst-backlog-browser-target-server-parity", JSON.stringify({ cases: 4, secondsPerCase: 240 }));
  } finally { for (const path of [entry, out]) if (await Bun.file(path).exists()) await unlink(path); }
}, 540000);
