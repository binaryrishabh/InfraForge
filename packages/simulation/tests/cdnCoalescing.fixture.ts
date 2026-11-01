import { cdnDesign } from "./cdnTtl.fixture";
import { prepare } from "./asyncCanvas.fixture";
import { requireKnown } from "../src/reality/quantity";
import { quantities } from "./workloadFixture";
import { systemsFixture, systemCommand } from "./systemsFixture";

export function coalescingDesign(coalesce = true, maxWaiters?: number, ttlSeconds?: number) {
  const saved = cdnDesign();
  Object.assign(saved.resources[0]!, { cdnCachePolicy: { version: 2, coalesce, ...(maxWaiters === undefined ? {} : { maxWaiters }), ...(ttlSeconds === undefined ? {} : { ttlSeconds }) } });
  return saved;
}
export function coalescingConfig(coalesce = true, maxWaiters?: number, ttlSeconds?: number) {
  const saved = coalescingDesign(coalesce, maxWaiters, ttlSeconds), adapted = prepare(saved);
  const config = adapted.compiled.input.resources.find(r => r.kind === "cdn")!;
  if (config.kind !== "cdn") throw Error("Expected CDN");
  return { saved, ...adapted, config };
}
// Copy only the saved policy's compiled settings; synthetic timings make the same-key burst overlap.
export function coalescingBurst(coalesce = true, maxWaiters?: number, ttlSeconds?: number, count = 10) {
  const { config } = coalescingConfig(coalesce, maxWaiters, ttlSeconds);
  const i = systemsFixture({ count: 0, monitoring: false, horizon: 40000 }), q = quantities(); i.arrivals = [];
  const cdn = i.resources.find(r => r.kind === "cdn")!; if (cdn.kind !== "cdn") throw Error("Expected CDN");
  cdn.coalesce = config.coalesce; cdn.maxWaiters = q.q("burst.limit", requireKnown(config.maxWaiters, "count"), "count");
  cdn.ttl = q.q("burst.ttl", requireKnown(config.ttl, "us"), "us");
  const origin = i.resources.find(r => r.kind === "object-store")!; if (origin.kind !== "object-store") throw Error("Expected origin");
  origin.demands.get!.wait = q.q("burst.origin.wait", 2000, "us");
  for (let n = 0; n < count; n++) systemCommand(i, `get-${n}`, 0, "$caller", "cdn", { kind: "get", key: "asset" });
  i.ledger.push(...q.ledger); return i;
}
