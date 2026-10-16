import { compileProviderProduct } from "../src/reality/provider/compile";
import { providerFixture, providerHasher } from "./providerFixture";
import type { MeteringConfig } from "../src/reality/metering/contracts";
import type { ObjectConfig } from "../src/model2/async/contracts";

export function meteringFixture(options: { capacity?: boolean; responseLoss?: boolean; outage?: boolean; maxRecords?: number } = {}) {
  const f = providerFixture({ slots: 2 }), store = f.contract.nodes.objects!.resources[0]!.config as Omit<ObjectConfig, "id">;
  if (options.capacity) store.capacity = f.q.q("meter.capacity", 5000, "bytes");
  const commands = [
    { id: "usage-create", at: 1000, request: { kind: "put", namespace: "usage", key: "key", bytes: 8, content: "v1" }, bytes: 8 },
    { id: "usage-overwrite", at: 2000, request: { kind: "put", namespace: "usage", key: "key", bytes: options.capacity ? 4096 : 17, content: "v2" }, bytes: options.capacity ? 4096 : 17 },
    { id: "usage-read", at: 2500, request: { kind: "get", namespace: "usage", key: "key" }, bytes: 0 },
    { id: "usage-delete", at: 3000, request: { kind: "delete", namespace: "usage", key: "key" }, bytes: 0 },
    { id: "usage-missing", at: 3500, request: { kind: "head", namespace: "usage", key: "key" }, bytes: 0 },
    { id: "usage-retain", at: 4000, request: { kind: "put", namespace: "usage", key: "retained", bytes: 23, content: "retained" }, bytes: 23 }
  ];
  for (const c of commands) f.contract.commands.push({ id: c.id, at: f.q.q(`${c.id}.at`, c.at, "us"), source: "$registry", target: "$objects", operation: "read", request: c.request, bodyBytes: f.q.q(`${c.id}.body`, c.bytes, "bytes"), provenance: "Authored usage verification workload, executed by actual compiled transport/object services" });
  if (options.responseLoss) {
    f.contract.transports.lab!.pool.responseTimeout = f.q.q("usage.response.timeout", 100, "us");
    f.contract.transports.lab!.links.find((l) => l.id === "response")!.propagation = f.q.q("usage.response.delay", 1000, "us");
  }
  if (options.outage) {
    f.contract.faults.push({ id: "usage-object-process", kind: "Crash", target: "objects", at: f.q.q("usage.object.crash.at", 5000, "us"), duration: f.q.q("usage.object.crash.duration", 10000, "us"), restart: f.q.q("usage.object.crash.restart", 1000, "us"), profile: "retain-logical-state/1" });
    for (const [id, at] of [["usage-during-outage", 6000], ["usage-after-recovery", 17000]] as const) f.contract.commands.push({ id, at: f.q.q(`${id}.at`, at, "us"), source: "$registry", target: "$objects", operation: "read", request: { kind: "get", namespace: "usage", key: "retained" }, bodyBytes: f.q.q(`${id}.bytes`, 0, "bytes"), provenance: "Authored logical process failure and recovery verification, not a cloud durability claim" });
  }
  const compiled = compileProviderProduct(f, f.provider, f.snapshot, providerHasher), objects = compiled.product.input.resources.filter((r) => r.kind === "object-store").map((r) => r.id);
  const config: MeteringConfig = { schema: "infraforge-usage-metering/1", run: "authored-product-usage-proof", epoch: "execution-1", inputFingerprint: compiled.fingerprint,
    provenance: ["packages/simulation/tests/meteringFixture.ts", "Observed modeled current-object commands and directed payload; no provider storage/transfer billing"], objects,
    links: compiled.product.input.links.filter((l) => objects.includes(l.from) || objects.includes(l.to)).map((l) => l.id), maxRecords: options.maxRecords ?? 8192, maxFields: 200000, maxTextCharacters: 2000000 };
  return { ...f, compiled, config };
}
