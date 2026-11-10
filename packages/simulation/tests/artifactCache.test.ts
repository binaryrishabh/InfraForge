import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { artifactDesign, artifactSetup } from "./artifactCache.fixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { validateArtifactCacheBindings } from "../src/model2/product/artifactCache";
import { createProductModel2 } from "../src/model2/product/run";
import { startupLive } from "../src/model2/product/startupLive";

function marked(capacityBytes = 4096) {
  const saved = artifactDesign(); saved.resources[1]!.artifactCachePolicy = { version: 1, capacityBytes }; return saved;
}
test("omitted artifact policy retains the exact pre-addition contract, compiled bytes and assumptions", () => {
  const f = artifactSetup();
  // Measured on 46f8a9f before the adapter/binding/projection changes.
  const pins = { contract: "543c8f28d9eb975184f1a7ff7cb24941ea11236ef8d411b4d29f1dcea851b8f7", compiled: "f2acd35ba7e3a980d69dd318129759c7b8f258265a093b78f760ac8414191d65", assumptions: "42ff372b2cc5cc8e17d64e14cb9a7e33d403ce1aa3d91f57ea3570070e6d7775" };
  for (const key of ["contract", "compiled", "assumptions"] as const) expect(createHash("sha256").update(JSON.stringify(f[key]).replaceAll("\r\n", "\n")).digest("hex")).toBe(pins[key]);
});
test("saved byte capacity binds independently to initial, cold and reserved artifact owners, including drawn registry", () => {
  for (const capacity of [1, 1024, 4096, Number.MAX_SAFE_INTEGER]) for (const drawn of [false, true]) {
    const saved = marked(capacity); saved.resources[1]!.autoscaling!.maxReplicas = 4;
    if (drawn) {
      saved.resources.push({ id: "registry", type: "Container Registry", x: 0, y: 1 }, { id: "blobs", type: "Object Storage", x: 0, y: 2 });
      saved.connections.push({id: "artifact", sourceId: "app", sourceType: "Virtual Machine", targetId: "registry", targetType: "Container Registry", port: 443},
        {id: "store", sourceId: "registry", sourceType: "Container Registry", targetId: "blobs", targetType: "Object Storage", port: 443});
    }
    const f = artifactSetup(saved), clients = f.compiled.input.resources.filter(r => r.kind === "artifact-client");
    expect(currentAdapterProfiles(saved.resources)).toContain("artifact-cache/1");
    expect(clients.map(c => c.cacheBytes)).toEqual(Array.from({length: 4}, () => expect.objectContaining({kind: "known", unit: "bytes", value: capacity})));
    expect(new Set(clients.map(c => c.id)).size).toBe(4);
    expect(f.contract.ledger.find(r => r.id === "app.image.cache")).toMatchObject({classification: "user-input"});
  }
});
test("artifact cache refuses absent, duplicate, unsupported, orphaned or mismatched profiles", () => {
  const f = artifactSetup(marked());
  for (const adapterProfiles of [[], ["artifact-cache/1", "artifact-cache/1"]] as const) expect(contractFromDesign(f.saved, {adapterProfiles})).toHaveProperty("refused");
  expect(contractFromDesign(artifactDesign(), {adapterProfiles: ["lb-health/1", "artifact-cache/1"]})).toHaveProperty("refused");
  for (const version of ["canvas-assumptions/2", "canvas-assumptions/2/artifact-cache/2", "canvas-assumptions/2/artifact-cache/10", "canvas-assumptions/2/artifact-cache/1/artifact-cache/1"]) for (const own of [true, false]) {
    const contract = structuredClone(f.contract);
    if (own) contract.nodes.app!.profileVersion = version; else contract.version = version;
    expect(compileProduct(f.saved, contract).ok).toBe(false);
  }
  const noIntent = artifactDesign(); expect(compileProduct(noIntent, f.contract).ok).toBe(false);
});
test("consistent provenance cannot disguise a different capacity or a shared/foreign artifact client", () => {
  const f = artifactSetup(marked());
  const config = f.contract.nodes.app!.resources.find(r => r.role === "image")!.config;
  if (config.kind !== "artifact-client" || config.cacheBytes.kind !== "known") throw Error("Expected cache");
  config.cacheBytes.value++;
  f.contract.ledger.find(r => r.id === config.cacheBytes.provenance[0])!.quantity = structuredClone(config.cacheBytes);
  expect(compileProduct(f.saved, f.contract).ok).toBe(false);
  for (const node of ["lb", "missing"]) {
    const other = artifactSetup(marked()); other.contract.nodes.app!.controller!.artifact.node = node;
    expect(compileProduct(other.saved, other.contract).ok).toBe(false);
  }
  for (const mutate of [
    (x: typeof f.compiled) => { x.pools[0]!.artifactClients[1]!.id = x.pools[0]!.artifactClients[0]!.id; },
    (x: typeof f.compiled) => { const c = x.input.resources.find(r => r.id === "app#1/image")!; if (c.kind === "artifact-client") c.replicas[0]!.target = "app#0"; },
    (x: typeof f.compiled) => { x.input.resources = x.input.resources.filter(r => r.id !== "app#1/image"); },
  ]) {
    const other = artifactSetup(marked()); mutate(other.compiled);
    expect(() => validateArtifactCacheBindings(other.saved.resources, other.compiled.input, other.compiled.pools)).toThrow();
  }
});
test("capacity projection is optional, observer-only and does not fabricate missing readiness", () => {
  for (const saved of [artifactDesign(), marked(256)]) {
    const {compiled} = artifactSetup(saved), run = createProductModel2(compiled); run.advanceTo(run.horizon);
    const before = run.evidence(), m = startupLive(compiled, run, "app", id => id.startsWith("app#") || id === "app" ? "app" : id, run.horizon)!;
    expect(run.evidence()).toEqual(before);
    if (saved.resources[1]!.artifactCachePolicy) {
      expect(m.clients!.every(c => c.capacityBytes === 256)).toBe(true);
      expect(m.clients![1]!.replicas![0]).toMatchObject({artifactReadyAtUs: null, state: "failed"});
      expect(m.controllers![0]!.replicas![0]!.listenerReadyAtUs).toBe(0);
      expect(m.controllers![0]!.replicas![1]!.listenerReadyAtUs).toBeNull();
    } else expect(m.clients!.every(c => !("capacityBytes" in c))).toBe(true);
  }
});
