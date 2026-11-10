import { expect, test } from "bun:test";
import { createSystemsModel2 } from "../src/model2/systems/run";
import type { StartupConfig } from "../src/model2/systems/contracts";
import { systemCommand, systemsFixture } from "./systemsFixture";
import { quantities } from "./workloadFixture";

const layer = `sha256:${"a".repeat(64)}`, image = `sha256:${"b".repeat(64)}`;
function fixture(capacity: number, duplicate = false) {
  const input = systemsFixture({count: 0, monitoring: false}), q = quantities(); input.arrivals = [];
  systemCommand(input, "layer", 0, "$caller", "registry", {kind: "upload", digest: layer, bytes: 128});
  systemCommand(input, "manifest", 500, "$caller", "registry", {kind: "manifest", digest: image, bytes: 64, layers: Array(duplicate ? 2 : 1).fill({digest: layer, bytes: 128})});
  const clients = input.resources.filter((r): r is StartupConfig => r.kind === "artifact-client");
  for (const [i, c] of clients.entries()) {
    c.cacheBytes = q.q(`admission.${i}.capacity`, capacity, "bytes");
    c.replicas = [{id: `cold-${i}`, target: i ? "replica-b" : "replica-a", reference: image, at: q.q(`admission.${i}.at`, 2000, "us")}];
  }
  input.ledger.push(...q.ledger); return input;
}
test("oversized layers stay unowned and unready through every retry; exact fit admits each unique layer once per client", () => {
  for (const capacity of [127, 128]) {
    const run = createSystemsModel2(fixture(capacity, true)); run.advanceTo(run.horizon); const raw = run.evidence();
    for (const c of raw.systems.clients) {
      expect(c.cachedBytes).toBe(c.cache.reduce((n, b) => n + b.bytes, 0));
      expect(c.cachedBytes).toBe(capacity === 127 ? 0 : 128);
      expect(c.pulledBytes).toBe(capacity === 127 ? 0 : 128);
      expect(c.replicas[0]!.readyAt === null).toBe(capacity === 127);
      expect(raw.network.endpoints[c.replicas[0]!.target]!.ready).toBe(capacity === 128);
      if (capacity === 127) {
        expect(c.replicas[0]!.attempts).toBe(3);
        expect(c.events.rows.map(e => e.detail)).toEqual(Array(3).fill("node-blob-cache-capacity"));
      } else {expect(c.cache).toHaveLength(1); expect(c.reusedLayers).toBe(1);}
    }
    if (capacity === 128) expect(raw.systems.clients.reduce((n, c) => n + c.pulledBytes, 0)).toBe(256); // Two independent owners, no shared-host reuse.
  }
});
test("content and size mismatches in the registry's backing object cannot become artifact readiness", () => {
  for (const wrong of [{bytes: 128, content: "different-content"}, {bytes: 129, content: layer}]) {
    const input = fixture(4096);
    systemCommand(input, "corrupt-backing-object", 1500, "$caller", "objects", {kind: "put", namespace: "registry", key: layer, ...wrong}, wrong.bytes);
    const run = createSystemsModel2(input); run.advanceTo(run.horizon); const raw = run.evidence();
    for (const c of raw.systems.clients) {
      expect(c.cachedBytes).toBe(0); expect(c.replicas[0]!.readyAt).toBeNull(); expect(c.replicas[0]!.state).toBe("failed");
      expect(c.events.rows.map(e => e.detail)).toEqual(Array(3).fill("layer-unavailable"));
      expect(raw.network.endpoints[c.replicas[0]!.target]!.ready).toBe(false);
    }
  }
});
test("invalid digest and conflicting blob/manifest sizes still refuse before startup", () => {
  const input = fixture(4096);
  systemCommand(input, "invalid-digest", 1000, "$caller", "registry", {kind: "upload", digest: "unverified", bytes: 128});
  systemCommand(input, "conflicting-size", 1000, "$caller", "registry", {kind: "upload", digest: layer, bytes: 129});
  systemCommand(input, "conflicting-manifest", 1000, "$caller", "registry", {kind: "manifest", digest: image, bytes: 64, layers: [{digest: layer, bytes: 129}]});
  const run = createSystemsModel2(input); run.advanceTo(run.horizon); const raw = run.evidence(), registry = raw.systems.registries[0]!;
  expect(Object.fromEntries(raw.systems.commands.results.map(r => [r.id, (r.reply as {reason?: string} | null)?.reason]))).toMatchObject({"invalid-digest": "invalid-digest", "conflicting-size": "immutable-blob-conflict", "conflicting-manifest": "missing-or-invalid-manifest-blob"});
  expect(registry.blobBytes).toBe(128); expect(registry.manifests[0]!.layers).toEqual([{digest: layer, bytes: 128}]);
  expect(raw.systems.clients.every(c => c.replicas[0]!.state === "running")).toBe(true);
});
