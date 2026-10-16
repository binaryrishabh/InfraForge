import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { providerFixture, providerHasher } from "../../packages/simulation/tests/providerFixture";
import { billingCampaign, providerCampaign } from "../../packages/simulation/tests/providerCases";
import { compileProviderProduct } from "../../packages/simulation/src/reality/provider/compile";
import { createProviderModel2 } from "../../packages/simulation/src/reality/provider/run";
import { productSourceHash } from "./product-source";
import { providerArtifactBytes, providerRoot, providerSourceHash, providerDigest as digest } from "./provider-source";
export function providerProofs() {
  const base = providerFixture();

  const variants = [
    { name: "normal", options: {} },

    { name: "memory-admission", options: { memory: 100 } },

    { name: "zone-incident", options: { domain: "zone" as const, min: 2, slots: 2 } },

    { name: "region-incident", options: { domain: "region" as const, min: 2, slots: 2 } },

    { name: "registry-retry", options: { registryOutage: true } },

    { name: "manual-drain", options: { manualDrain: true } },

    { name: "provision-failure", options: { provisionFailure: true } },

    { name: "unpriced", options: { unpriced: true } }
  ];

  const cases = variants.map(({ name, options }) => {
    const f = providerFixture(options), compiled = compileProviderProduct(f, f.provider, f.snapshot, providerHasher), run = createProviderModel2(compiled, providerHasher);

    const captures = [100, 70000, 95000, 120000].map((at) => {
      run.advanceTo(at);

      const e = run.evidence();

      if (e.model.capture.failure) throw Error(e.model.capture.failure);

      const { linkUsage, ...provider } = e.provider;

      return {
        at,

        capture: e.model.capture,

        counts: e.model.counts,

        provider,

        links: {
          count: linkUsage.length,

          deliveredBytes: linkUsage.reduce((n, r) => n + r.deliveredBytes, 0),

          scope: "Sum of directed link payload counters, not provider transfer usage"
        },

        resources: e.model.resources.filter((r) => /^vm#\d+$/.test(r.id)).map((r) => ({
          id: r.id,

          admitted: r.admitted,

          rejected: r.rejected,

          completed: r.completed,

          queued: r.queued,

          serving: r.serving,

          waiting: r.waiting,

          cpu: r.consumedCoreUs,

          memory: r.compute?.memory,

          allocationRejected: r.compute?.allocationRejected
        })),

        controllers: e.model.product.controllers.map((p) => ({
          id: p.id,

          desired: p.desired,

          inService: p.inService,

          populations: p.populations,

          replicas: p.replicas,

          omitted: p.omitted,

          events: p.events.filter((v) => ["replica-created", "artifact-start", "artifact-failed", "readiness", "draining", "terminated", "provision-failed"].includes(v.kind))
        }))
      };
    });

    return {
      name,

      options,

      authoredHash: digest({ design: f.design, contract: f.contract, provider: f.provider }),

      compiledHash: compiled.fingerprint,

      captures
    };
  });

  return {
    schema: "infraforge-provider-proofs/1",

    complete: true,

    sourceHash: providerSourceHash(),

    foundationHash: productSourceHash(),

    sourceExtractHash: digest(base.raw),

    sourceReviewHash: digest(base.reviews),

    authoredBase: { design: base.design, contract: base.contract, provider: base.provider, snapshot: base.snapshot },

    cases,

    billing: billingCampaign(),

    compiler: providerCampaign(),

    omitted: "Compiled SystemsInput and repeated configurations are reconstructed from retained authored base, versioned variant generator and compiled hashes. Routine request/health traces omitted; counts, actual lifecycle, memory, usage and costs retained."
  };
}
export function validateProviderProofs() {
  const retained = JSON.parse(readFileSync(resolve(providerRoot, "docs/reality/m2i-proofs.json"), "utf8"));

  const current = providerProofs();

  if (digest(retained) !== digest(current)) throw Error("M2I retained facts/source/campaign/evidence drift; regenerate only after review");

  if (providerArtifactBytes() > 1048576) throw Error("M2I evidence exceeds one MiB review budget; remove duplication without deleting proof");

  return {
    cases: current.cases.length,

    captures: current.cases.reduce((n, c) => n + c.captures.length, 0),

    billing: current.billing,

    compiler: current.compiler,

    artifactBytes: providerArtifactBytes()
  };
}
if (import.meta.main) {
  if (process.argv.includes("--write")) {
    const proof = providerProofs();

    writeFileSync(resolve(providerRoot, "docs/reality/m2i-proofs.json"), JSON.stringify(proof) + "\n");

    if (providerArtifactBytes() > 1048576) throw Error("M2I evidence exceeds one MiB review budget");

    console.info(JSON.stringify({
      written: true,

      cases: proof.cases.length,

      billing: proof.billing,

      compiler: proof.compiler,

      artifactBytes: providerArtifactBytes()
    }));
  } else console.info(JSON.stringify(validateProviderProofs()));
}
