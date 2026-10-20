import { readFileSync, writeFileSync } from "node:fs";
import { platform, arch, cpus, totalmem } from "node:os";
import { cpuUsage, memoryUsage } from "node:process";
import { performance } from "node:perf_hooks";
import { firstStackCompileFixture } from "../fixtures/first-stack-compile";
import { createFirstStackRuntime } from "../../packages/simulation/src/firstStack/run";
import { compileFirstStack } from "../../packages/simulation/src/firstStack/compiler";
import { boundedJson, FIRST_STACK_ENVELOPE as envelope } from "../../packages/simulation/src/firstStack/bounds";
import { sourceHash, digest } from "../../apps/backend/executionIdentity/hash";
import { compositionProofs } from "./composition-proofs";

const path = "docs/reality/first-stack-faults-bounds-proof.json";
export async function boundsProof() {
  const cases = [];
  for (const apps of [1, 2, 4, 8]) {
    const f = await firstStackCompileFixture(apps), runtime = createFirstStackRuntime(f.sidecar, f.schedule, f.policy);
    let slices = 1;
    while (!runtime.advanceSlice(runtime.horizon, envelope.sliceEvents)) slices++;
    const e = runtime.evidence(), full = createFirstStackRuntime(f.sidecar, f.schedule, f.policy);
    full.advanceTo(full.horizon);
    if (digest(full.evidence()) !== digest(e)) throw Error("Bounded slices changed outcomes");
    cases.push({ apps, roots: f.schedule.rows.length, slices, execution: e.execution, counts: e.counts,
      evidence: digest(e), journal: runtime.journal.measure(), summaryBytes: Buffer.byteLength(boundedJson(e, envelope.summaryBytes)) });
  }
  const old = JSON.parse(readFileSync("docs/reality/first-stack-compile-proof.json", "utf8"));
  return { schema: "first-stack-bounds-proof/1", scope: "Internal software qualification only; no host containment, measured cloud calibration or Model 2 activation", envelope,
    sources: ["packages/simulation/src/firstStack/bounds.ts", "packages/simulation/src/firstStack/journal.ts", "packages/simulation/src/firstStack/run.ts", "apps/backend/firstStack/boundedExecution.ts", "scripts/tests/first-stack-bounds.test.ts", "scripts/fixtures/first-stack-bounded-execution.test.ts"].map(path => ({ path, hash: sourceHash(readFileSync(path, "utf8")) })),
    retainedSlice04Proof: digest(old), historicalCompositions: compositionProofs(), cases };
}
export async function verifyBoundsProof(write = false) {
  const actual = await boundsProof();
  if (write) writeFileSync(path, JSON.stringify(actual, null, 2) + "\n");
  if (digest(actual) !== digest(JSON.parse(readFileSync(path, "utf8")))) throw Error("Bounds proof drift; review and run --write");
  return { cases: actual.cases.length, historicalCompositions: actual.historicalCompositions.length };
}
async function measure() {
  const cases = [];
  for (const apps of [1, 2, 4, 8]) {
    const f = await firstStackCompileFixture(apps), cpu = cpuUsage();
    let at = performance.now(); compileFirstStack(f.sidecar, f.schedule, f.policy); const compileMs = performance.now() - at;
    at = performance.now(); const runtime = createFirstStackRuntime(f.sidecar, f.schedule, f.policy); const setupMs = performance.now() - at;
    let peakObservedRssBytes = memoryUsage().rss, maxSliceMs = 0, slices = 0; at = performance.now();
    let done = false;
    while (!done) {
      const slice = performance.now(); done = runtime.advanceSlice(runtime.horizon, envelope.sliceEvents); slices++;
      maxSliceMs = Math.max(maxSliceMs, performance.now() - slice); peakObservedRssBytes = Math.max(peakObservedRssBytes, memoryUsage().rss);
    }
    const executeMs = performance.now() - at;
    at = performance.now(); const evidence = runtime.evidence(); const reduceMs = performance.now() - at;
    at = performance.now(); const json = boundedJson(evidence, envelope.summaryBytes); const serializeMs = performance.now() - at;
    const usage = cpuUsage(cpu);
    cases.push({ apps, seed: f.policy.seed, roots: f.schedule.rows.length, compileMs, setupMs, executeMs, reduceMs, serializeMs,
      slices, maxSliceMs, processedEvents: evidence.execution.processed, peakPending: evidence.execution.peakPending,
      outputBytes: Buffer.byteLength(json), journalBytes: runtime.journal.measure().bytes, peakObservedRssBytes, cpuUs: usage.user + usage.system });
  }
  const artifact = { schema: "first-stack-bounds-performance/1", measuredAt: new Date().toISOString(), runtime: `bun-${Bun.version}`,
    host: { platform: platform(), arch: arch(), logicalCpus: cpus().length, totalMemoryBytes: totalmem() },
    limitation: "One sequential fixed-seed pilot per app count on a shared host; RSS sampled between slices, not an OS high-water mark. Setup includes compilation/validation. Does not qualify the 8 GB laptop or 4 vCPU/8 GiB server, concurrency or worst-case combinations.", cases };
  writeFileSync("docs/reality/first-stack-bounds-performance.json", JSON.stringify(artifact, null, 2) + "\n");
  return artifact;
}
if (import.meta.main) console.info(JSON.stringify(process.argv.includes("--measure") ? await measure() : await verifyBoundsProof(process.argv.includes("--write"))));
