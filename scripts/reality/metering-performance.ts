import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cpus, release } from "node:os";
import { meteringFixture } from "../../packages/simulation/tests/meteringFixture";
import { providerHasher } from "../../packages/simulation/tests/providerFixture";
import { createMeteredProviderModel2 } from "../../packages/simulation/src/reality/metering/run";
import { replayUsage } from "../../packages/simulation/src/reality/metering/replay";
import { meteringArtifactBytes, meteringRoot, meteringSourceHash } from "./metering-source";

export function measureMetering() {
  const memoryBefore = process.memoryUsage(), begin = performance.now(), f = meteringFixture(), compiled = performance.now();
  const runtime = createMeteredProviderModel2(f.compiled, f.config, providerHasher), setup = performance.now();
  runtime.advanceTo(runtime.horizon); const executed = performance.now(), evidence = runtime.evidence(), captured = performance.now(), frame = runtime.frame(), framed = performance.now();
  const serializedBytes = Buffer.byteLength(JSON.stringify(frame)), serialized = performance.now(), replay = replayUsage(frame, providerHasher), replayed = performance.now();
  const overflowFixture = meteringFixture({ maxRecords: 1 }), overflow = createMeteredProviderModel2(overflowFixture.compiled, overflowFixture.config, providerHasher);
  overflow.advanceTo(overflow.horizon); const bounded = overflow.frame();
  if (!evidence.usage.complete || !replay.matches || bounded.snapshot.complete || bounded.records.length !== 1) throw Error("Executor evidence/bounds verification failed");
  return { schema: "infraforge-usage-executor-measurement/1", complete: true, sourceHash: meteringSourceHash(), measuredAt: new Date().toISOString(),
    environment: { bun: Bun.version, platform: process.platform, arch: process.arch, osRelease: release(), cpu: cpus()[0]?.model ?? "Unknown" },
    scope: "Single developer-host wall-clock and process memory observations; not provider physical timing or a statistical performance claim. Memory includes runtime and allocator state.",
    compileMs: compiled - begin, setupMs: setup - compiled, runMs: executed - setup, captureMs: captured - executed, frameMs: framed - captured, serializeMs: serialized - framed, replayMs: replayed - serialized,
    memoryBefore, memoryAfter: process.memoryUsage(), retained: frame.retained, serializedBytes, overflow: { retained: bounded.retained, omitted: bounded.snapshot.omittedRecords, complete: bounded.snapshot.complete } };
}
if (import.meta.main) {
  const measurement = measureMetering(); writeFileSync(resolve(meteringRoot, "docs/reality/m2j-performance.json"), JSON.stringify(measurement, null, 2) + "\n");
  if (meteringArtifactBytes() > 1048576) throw Error("M2J evidence review budget exceeded"); console.info(JSON.stringify(measurement));
}
