import { keyspaceDesign, prepareKeyspace } from "./keyspace.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { withRunLength } from "../src/model2/product/runContract";
import { withTimeline } from "../src/model2/product/timeline";

export function replicaCacheFreshness(ttlSeconds: number, readPolicy: "primary" | "replica-preferred" = "replica-preferred") {
  const saved = keyspaceDesign();
  saved.resources[1]!.cachePolicy = { version: 1, ttlSeconds };
  saved.resources[2]!.databaseReplication = { version: 1, enabled: true, replicationDelayMs: 2000, readPolicy };
  const adapted = prepareKeyspace(saved, "replica-cache-freshness");
  const contract = withTimeline(withRunLength(adapted.contract, 6, "replica-cache-freshness"), [
    { id: "lose-writer", kind: "intervention", atUs: 2400000, request: { interventionId: "db-fail-primary", revision: 1, target: { resourceId: "db" }, parameters: { duration: 2 } } },
    { id: "promote", kind: "intervention", atUs: 3000000, request: { interventionId: "db-promote-replica", revision: 1, target: { resourceId: "db" }, parameters: {} } },
  ]);
  const compiled = compileProduct(saved, contract);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  compiled.value.input.arrivals = [{ id: "freshness", kind: "trace", trace: {
    schema: "infraforge-arrivals/1", unit: "us", durationUs: 6000000,
    provenance: "Authored read-after-write, lag, cache expiry and writer-loss boundaries",
    rows: [[10000, "write"], [100000, "read"], [2200000, "read"], [2500000, "read"], [2600000, "write"], [3100000, "write"], [3300000, "read"], [5000000, "read"]].map(([atUs, operation], i) => ({ id: String(i), atUs: atUs as number, operation: operation as string })),
  } }];
  return { saved, contract, compiled: compiled.value, runtime: createProductModel2(compiled.value) };
}
