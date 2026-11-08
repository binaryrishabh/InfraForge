import { expect, test } from "bun:test";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { startupLive } from "../src/model2/product/startupLive";
import { productFixture } from "./productFixture";

function fixture() {
  const f = productFixture(), c = compileProduct(f.design, f.contract);
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  return c.value;
}
const owner = (id: string) => id.startsWith("vm#") || id === "vm" ? "vm" : id;

test("startup observation does not change engine decisions, results, ownership or deterministic replay", () => {
  const compiled = fixture(), observed = createProductModel2(compiled), control = createProductModel2(compiled);
  for (const at of [20000, 60510, 62500, observed.horizon]) {
    observed.advanceTo(at); control.advanceTo(at);
    const before = observed.evidence();
    for (const id of ["vm", "registry", "objects"]) startupLive(compiled, observed, id, owner, at);
    expect(observed.evidence()).toEqual(before);
    expect(observed.evidence()).toEqual(control.evidence());
  }
});

test("unavailable source observations stay null and unrelated owners acquire no startup measurements", () => {
  const compiled = fixture(), source = {inspectRegistry: () => undefined, inspectArtifactClient: () => undefined, inspectControllers: () => []};
  const m = startupLive(compiled, source, "vm", owner, 0)!;
  expect(m.clients![0]).toMatchObject({pulledBytes: null, reusedLayers: null, failures: null, cachedBytes: null, replicas: null, omittedReplicas: null, events: null, omittedEvents: null});
  expect(m.controllers![0]).toMatchObject({desired: null, inService: null, replicas: null, events: null});
  expect(startupLive(compiled, source, "registry", owner, 0)!.registries![0]).toMatchObject({blobs: null, tags: null, manifests: null, blobBytes: null});
  expect(startupLive(compiled, source, "objects", owner, 0)).toBeUndefined();
});

test("projection bounds every retained identity/layer/event list and accounts for source event omissions", () => {
  // Synthetic overflow of real record shapes tests projection budgets only; these are not run outcomes.
  const compiled = fixture(), runtime = createProductModel2(compiled); runtime.advanceTo(runtime.horizon);
  const raw = runtime.evidence(), registry = structuredClone(raw.systems.registries[0]!), client = structuredClone(raw.systems.clients[0]!), controller = structuredClone(raw.product.controllers[0]!);
  const digest = (i: number) => `sha256:${i.toString(16).padStart(64, "0")}`;
  registry.blobs = Array.from({length: 103}, (_, i) => ({digest: digest(i), bytes: 1}));
  registry.manifests = Array.from({length: 102}, (_, i) => ({digest: digest(i), bytes: 1, layers: registry.blobs}));
  registry.tags = Object.fromEntries(registry.blobs.map((b, i) => [`tag${i}`, b.digest]));
  client.cache = registry.blobs; client.replicas = Array.from({length: 104}, (_, i) => ({...client.replicas[0]!, id: `replica-${i}`, requiredLayers: registry.blobs}));
  client.events = {rows: Array.from({length: 105}, () => ({at: 0, id: client.id, kind: "test-only", detail: "synthetic budget boundary"})), omitted: 7};
  controller.replicas = Array.from({length: 106}, (_, i) => ({...controller.replicas[0]!, id: `replica-${i}`}));
  controller.events = client.events.rows; controller.omitted = 9;
  const source = {inspectRegistry: () => registry, inspectArtifactClient: () => client, inspectControllers: () => [controller]};
  const m = startupLive(compiled, source, "vm", owner, runtime.horizon)!;
  expect(m.clients![0]!.cache).toHaveLength(100); expect(m.clients![0]!.omittedCache).toBe(3);
  expect(m.clients![0]!.replicas).toHaveLength(100); expect(m.clients![0]!.omittedReplicas).toBe(4);
  expect(m.clients![0]!.replicas![0]!.requiredLayers).toHaveLength(100); expect(m.clients![0]!.replicas![0]!.omittedLayers).toBe(3);
  expect(m.clients![0]!.events).toHaveLength(100); expect(m.clients![0]!.omittedEvents).toBe(12);
  expect(m.controllers![0]!.replicas).toHaveLength(100); expect(m.controllers![0]!.omittedReplicas).toBe(6);
  expect(m.controllers![0]!.events).toHaveLength(100); expect(m.controllers![0]!.omittedEvents).toBe(14);
  const r = startupLive(compiled, source, "registry", owner, runtime.horizon)!.registries![0]!;
  expect(r.blobs).toHaveLength(100); expect(r.omittedBlobs).toBe(3);
  expect(r.manifests).toHaveLength(100); expect(r.omittedManifests).toBe(2);
  expect(r.manifests![0]!.layers).toHaveLength(100); expect(r.manifests![0]!.omittedLayers).toBe(3);
  expect(r.tags).toHaveLength(100); expect(r.omittedTags).toBe(3);
  const large = structuredClone(compiled), template = compiled.input.resources.find(r => r.kind === "artifact-client")!;
  large.input.resources = Array.from({length: 101}, (_, i) => ({...template, id: `vm#${i}/image`}));
  expect(startupLive(large, source, "vm", owner, runtime.horizon)).toMatchObject({omittedClients: 1});
  expect(startupLive(large, source, "vm", owner, runtime.horizon)!.clients).toHaveLength(100);
});
