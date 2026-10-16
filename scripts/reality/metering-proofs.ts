import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { meteringFixture } from "../../packages/simulation/tests/meteringFixture";
import { providerHasher } from "../../packages/simulation/tests/providerFixture";
import { createMeteredProviderModel2 } from "../../packages/simulation/src/reality/metering/run";
import { createProviderModel2 } from "../../packages/simulation/src/reality/provider/run";
import { usageWindow } from "../../packages/simulation/src/reality/metering/windows";
import { combineUsageWindows } from "../../packages/simulation/src/reality/metering/combine";
import { replayUsage } from "../../packages/simulation/src/reality/metering/replay";
import { historicalFoundationHash, historicalProviderHash, verifyHistoricalArtifacts } from "./source-lineage";
import { meteringArtifactBytes, meteringDigest, meteringRoot, meteringSourceHash } from "./metering-source";

export function meteringProofs() {
  verifyHistoricalArtifacts();
  const base = meteringFixture(), variants = [
    { name: "normal", options: {} }, { name: "capacity-rejection", options: { capacity: true } },
    { name: "response-loss-after-commit", options: { responseLoss: true } }, { name: "process-retention", options: { outage: true } },
    { name: "collector-overflow", options: { maxRecords: 1 } }
  ];
  const cases = variants.map(({ name, options }) => {
    const f = meteringFixture(options), runtime = createMeteredProviderModel2(f.compiled, f.config, providerHasher), plain = createProviderModel2(f.compiled, providerHasher);
    const cuts = [runtime.evidence().usage];
    for (let i = 1; i <= 32; i++) { runtime.advanceTo(i * runtime.horizon / 32); cuts.push(runtime.evidence().usage); }
    plain.advanceTo(plain.horizon);
    const final = runtime.evidence(), reference = plain.evidence(), frame = runtime.frame(), window = usageWindow(cuts[0]!, cuts.at(-1)!, providerHasher);
    if (final.model.capture.failure || meteringDigest(final.model) !== meteringDigest(reference.model) || meteringDigest(final.provider) !== meteringDigest(reference.provider) || final.provider.total.kind !== "Unknown") throw Error(`Usage altered actual model/provider execution: ${name}`);
    if (options.maxRecords) {
      if (final.usage.complete || frame.records.length !== 1 || window.kind !== "Unknown") throw Error("Retention overflow did not fail closed");
    } else {
      if (!final.usage.complete || window.kind !== "Observed" || !replayUsage(frame, providerHasher).matches) throw Error(`Incomplete real usage proof: ${name}`);
      const parts = cuts.slice(1).map((cut, i) => usageWindow(cuts[i]!, cut, providerHasher));
      if (meteringDigest(combineUsageWindows(parts, providerHasher)) !== meteringDigest(window)) throw Error(`Window recombination failed: ${name}`);
      if (combineUsageWindows([window, window], providerHasher).kind !== "Unknown") throw Error("Repeated windows became additive");
    }
    return { name, options, compiled: f.compiled.fingerprint, model: meteringDigest(final.model), provider: meteringDigest(final.provider), cuts: cuts.map((c) => ({ atUs: c.atUs, fingerprint: c.fingerprint, complete: c.complete })), window, frame };
  });
  return { schema: "infraforge-usage-proofs/1", complete: true, sourceHash: meteringSourceHash(), historicalFoundation: historicalFoundationHash(), historicalProvider: historicalProviderHash(),
    authoredBase: { design: base.design, contract: base.contract, provider: base.provider, config: base.config }, cases,
    scope: "Observed authored simulated object state, service attempts and directed payload only. Provider storage/request/transfer billing and full bill Unknown.",
    omitted: "Each variant is reconstructed from retained authored base plus source-pinned fixture options. Routine model traces and duplicate cumulative frames are omitted; one replayable source-event frame per variant is retained." };
}
export function validateMeteringProofs() {
  const retained = JSON.parse(readFileSync(resolve(meteringRoot, "docs/reality/m2j-proofs.json"), "utf8")), actual = meteringProofs();
  if (meteringDigest(retained) !== meteringDigest(actual)) throw Error("M2J current source, authored input or actual evidence drift");
  if (meteringArtifactBytes() > 1048576) throw Error("M2J proof/lineage/measurement review budget exceeded");
  return { cases: actual.cases.length, cuts: actual.cases.reduce((n, c) => n + c.cuts.length, 0), records: actual.cases.reduce((n, c) => n + c.frame.records.length, 0), artifactBytes: meteringArtifactBytes(), sourceHash: actual.sourceHash };
}
if (import.meta.main) {
  if (process.argv.includes("--write")) writeFileSync(resolve(meteringRoot, "docs/reality/m2j-proofs.json"), JSON.stringify(meteringProofs()) + "\n");
  console.info(JSON.stringify(validateMeteringProofs()));
}
