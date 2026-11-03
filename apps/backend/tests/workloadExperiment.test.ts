import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import type { RunInputs } from "@infraforge/contracts/run-inputs";
import { requestsPerSecond } from "@infraforge/domain/workload";
import { buildRerunOptions, rerunInputHash } from "../reruns/options";
import { createWorkloadVariantInput } from "../reruns/variants";
import { classifyComparison } from "../comparison/classify";
import { input, measure, seconds } from "./workloadExperiment.fixture";

const withoutDynamics = (input: RunInputs) => {
  const {workloadDynamics: _, ...workloadProfile} = input.workloadProfile;
  return {...input, workloadProfile};
};
test("official one-dimension workload experiments preserve inputs, deterministic replay and truthful matched comparisons", async () => {
  const a = measure(input, "a", seconds), options = buildRerunOptions(a.row, null);
  const built = buildContractFromRunInputs(input, seconds); if ("refused" in built) throw Error(JSON.stringify(built));
  const read = built.contract.application!.demands.find(d => d.operation === "read")!;
  expect(read.cpu).toMatchObject({kind: "known", value: 3000});
  expect(requestsPerSecond(input.workloadProfile)).toBe(180);
  expect(options.matchedStop).toMatchObject({target: seconds, defaultEnabled: true});
  const candidates = ["poisson", "moderate", "high"].map(value => {
    const choice = options.workloadVariant.choices.find(c => c.variant.value === value)!;
    expect(choice.available).toBe(true);
    const candidate = createWorkloadVariantInput(input, choice.variant);
    expect(candidate.seed).toBe(input.seed); expect(withoutDynamics(candidate)).toEqual(withoutDynamics(input));
    expect(rerunInputHash(candidate)).toBe(choice.inputHash!);
    return candidate;
  });
  const runs = [a, ...candidates.map((candidate, i) => measure(candidate, ["b", "c-moderate", "c-high"][i]!, options.matchedStop.target!, a.row.id))];
  for (const run of runs) {
    expect(JSON.stringify(measure(run.input, run.row.id, seconds).evidence)).toBe(JSON.stringify(run.evidence));
    expect(run.limits).toEqual([]); expect(run.records.terminal?.traffic).toEqual(run.view.traffic);
  }
  for (const run of runs.slice(1)) {
    const pair = classifyComparison(a.row, run.row);
    expect(pair).toMatchObject({lineage: "source-and-rerun", headline: "matched-pair",
      starting: {grade: "one-change-workload", facets: {workload: "different", seed: "same", topology: "same", model: "same", catalog: "same"}}, evidence: {matchedDuration: true}});
    expect(pair.traffic!.find(m => m.field === "Original requests offered, whole run")?.later).toBe(run.evidence.counts.offered);
    expect(pair.traffic!.filter(m => m.field.startsWith("Original requests")).every(m => m.delta !== null)).toBe(true);
  }
  const path = resolve(import.meta.dir, `../../../.cache/workload-experiment-browser-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const run of runs.slice(0, 2)) {
      const browser = browserRun(run.input, seconds);
      for (const view of run.views) {browser.advance(); expect(browser.view()).toEqual(view);}
      expect(JSON.stringify(browser.evidence())).toBe(JSON.stringify(run.evidence));
    }
  } finally {if (await Bun.file(path).exists()) await unlink(path);}
  const unmarked = {...input, adapterProfiles: input.adapterProfiles!.filter(p => p !== "traffic-evidence/2")};
  const historicalOptions = buildRerunOptions({...a.row, runInputs: unmarked}, null);
  const oldChoice = historicalOptions.workloadVariant.choices.find(c => c.variant.value === "poisson")!;
  expect(oldChoice.available).toBe(true);
  const historicalVariant = createWorkloadVariantInput(unmarked, oldChoice.variant);
  expect(historicalVariant.adapterProfiles).toEqual(unmarked.adapterProfiles);
  expect(measure(historicalVariant, "historical", seconds).view.traffic.wholeRun).toBeUndefined();
  for (const row of [{...a.row, challengeId: "attempt", challengeVersion: 1}, {...a.row, status: "live"},
    {...a.row, runInputs: {...input, simulationModelVersion: "1"}}]) expect(buildRerunOptions(row, null).workloadVariant.available).toBe(false);
  const unmatched = measure(candidates[0]!, "b-unmatched", seconds + 1, a.row.id, false);
  const withheld = classifyComparison(a.row, unmatched.row);
  expect(withheld.evidence.matchedDuration).toBe(false);
  expect(withheld.traffic!.filter(m => m.field.startsWith("Original requests")).every(m => m.delta === null &&
    m.withheldReason === "Different observation durations: whole-run totals are not comparable.")).toBe(true);
  console.info("workload-experiment-proof", JSON.stringify({seed: input.seed, seconds, configuredRequestsPerSecond: requestsPerSecond(input.workloadProfile),
    arithmetic: "One worker; read CPU 3 ms + DB CPU 1 ms + assumed transport. 180/s gives 54% application service occupancy before dependency wait (about 76% including DB and network); no randomness tuning.",
    runs: runs.map(run => ({id: run.row.id, dynamics: run.input.workloadProfile.workloadDynamics ?? {arrivalProcess: "even", applicationCpuCv: 0},
      counts: run.evidence.counts, maxQueuedAtSecondBoundaries: run.maxQueued, lastSecond: {offered: run.view.traffic.offeredRps, completed: run.view.traffic.completedRps, failed: run.view.traffic.failedRps, latencyMs: run.view.traffic.latencyMs},
      wholeRun: run.view.traffic.wholeRun, clientRetry: run.view.traffic.clientRetry ?? null, objective: run.view.traffic.objective ?? null})),
    unmatched: {seconds: seconds + 1, counts: unmatched.evidence.counts}}));
}, 180000);
