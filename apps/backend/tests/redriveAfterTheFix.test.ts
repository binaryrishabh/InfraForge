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
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

const ID = "redrive-after-the-fix";
/** Starter, the hidden one-change reference (later redrive), and the near miss that only raises the delivery limit. */
function variants() {
  const d = definition(ID), starter = d.starter!, near = structuredClone(starter);
  near.resources.find(r => r.id === "queue")!.asyncQueue!.maxReceives = 10;
  return { d, designs: [starter, REFERENCE[ID]!, near] };
}

test("redrive-after-the-fix: one-change reference passes, near miss and starter fail, saved reports round-trip", () => {
  const { d, designs } = variants(), start = designs[0]!;
  expect(validateInfrastructureName(d.title)).toBeNull();
  expect(specHash(d)).toBe(/"redrive-after-the-fix@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!);
  for (const design of designs) expect(preflight(d, design).errors).toEqual([]);
  const inputs = designs.map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
  for (const i of [1, 2]) expect(reviewDesignChanges(inputs[0]!, inputs[i]!)).toMatchObject({ classification: "one-change", count: 1 });
  const rows = designs.map(s => attemptRow(d, s, answers(d, { health: "healthy" }))), reports = rows.map(r => buildRunReport(r));
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  const q = reports.map(r => r.terminal!.resources.find(x => x.id === "queue")!.queueWork!);
  expect(q.map(x => [x.originals, x.acknowledged, x.deadLettered, x.redriven])).toEqual([[720, 654, 104, 38], [720, 720, 66, 66], [720, 654, 103, 37]]);
  // Margins against the 700-message floor: both failing designs lose at least 40 messages' worth of margin, so no engine or seed rounding can flip them.
  expect(700 - q[0]!.acknowledged).toBeGreaterThanOrEqual(40); expect(700 - q[2]!.acknowledged).toBeGreaterThanOrEqual(40); expect(q[1]!.acknowledged - 700).toBeGreaterThanOrEqual(20);
  expect(start.resources.find(r => r.id === "worker")!.asyncWorker!.repairAtSecond).toBe(40);
  expect(start.resources.find(r => r.id === "queue")!.asyncQueue!.redriveAtSecond).toBe(20);
  for (const [i, row] of rows.entries()) {
    const saved = { ...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot)) };
    expect(buildRunReport(saved).terminal).toEqual(reports[i]!.terminal);
    expect(buildRunReport(saved).challenge).toEqual(reports[i]!.challenge);
    expect(inputs[i]!.adapterProfiles).toContain("queue-redrive/1");
  }
});

test("redrive-after-the-fix: saved settings are validated and the profile cannot be omitted or invented", () => {
  const { d, designs } = variants(), good = designs[0]!;
  const bad = (fn: (s: typeof good) => void) => { const s = structuredClone(good); fn(s); return s; };
  const noBad = bad(s => { delete s.resources.find(r => r.id === "worker")!.asyncWorker!.badJobPercent; });
  expect(() => captureRunInputs(noBad, d.workload, "x")).toThrow();
  expect(() => captureRunInputs(bad(s => { s.resources.find(r => r.id === "queue")!.asyncQueue!.redriveAtSecond = 0; }), d.workload, "x")).toThrow();
  const input = JSON.parse(JSON.stringify(captureRunInputs(good, d.workload, "x")));
  input.adapterProfiles = input.adapterProfiles.filter((p: string) => p !== "queue-redrive/1");
  expect(() => createModel2Engine(readRunInputs(input), 90)).toThrow("queue-redrive");
  const plain = captureRunInputs(bad(s => { delete s.resources.find(r => r.id === "queue")!.asyncQueue!.redriveAtSecond; delete s.resources.find(r => r.id === "worker")!.asyncWorker!.repairAtSecond; }), d.workload, "x");
  expect(plain.adapterProfiles ?? []).not.toContain("queue-redrive/1");
});

test("redrive-after-the-fix: browser-target bundle and default server replay agree every second for all three variants", async () => {
  const entry = resolve(import.meta.dir, `../../../.cache/redrive-${process.pid}.ts`), out = entry.replace(/\.ts$/, ".mjs");
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
      expect(input.adapterProfiles).toContain("queue-redrive/1");
      expect(browserContract(input, 90)).toEqual(buildContractFromRunInputs(input, 90));
      const browser = browserRun(input, 90), server = createModel2Engine(input, 90);
      for (let second = 1; second <= 90; second++) { browser.advance(); server.advance(); expect(browser.view()).toEqual(server.view()); expect(browser.evidence()).toEqual(server.evidence()); }
    }
    console.info("redrive-browser-target-server-parity", JSON.stringify({ cases: 3, secondsPerCase: 90 }));
  } finally { for (const path of [entry, out]) if (await Bun.file(path).exists()) await unlink(path); }
}, 240000);
