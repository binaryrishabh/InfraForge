import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { prepare } from "./asyncCanvas.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { withRunLength } from "../src/model2/product/runContract";
import { createProductModel2 } from "../src/model2/product/run";
import { productFixture } from "./productFixture";

export const cdnModes = ["storage", "repeated", "dns", "monitoring"] as const;
export function cdnDesign(mode: typeof cdnModes[number] = "repeated", ttlSeconds?: number): SavedProductDesign {
  const types: Record<string, Resource["type"]> = { cdn: "CDN", store: "Object Storage", ...(mode === "dns" ? { dns: "DNS" as const } : {}), ...(mode === "monitoring" ? { monitor: "Monitoring Agent" as const } : {}) };
  const links = [["cdn", "store"], ...(mode === "dns" ? [["dns", "cdn"]] : []), ...(mode === "monitoring" ? [["monitor", "cdn"]] : [])];
  const saved: SavedProductDesign = { schema: "infraforge-saved-design/1", resources: Object.entries(types).map(([id, type]) => ({ id, type, x: 0, y: 0 })), connections: links.map(([s, t], i) => ({ id: `e${i}`, sourceId: s!, targetId: t!, sourceType: types[s!]!, targetType: types[t!]!, port: RESOURCE_PORTS[types[t!]!] })), workload: { targetThroughput: mode === "storage" ? 6 : 120, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light" } };
  if (ttlSeconds !== undefined) Object.assign(saved.resources[0]!, { cdnCachePolicy: { version: 1, ttlSeconds } });
  return saved;
}
export function cdnSetup(mode: typeof cdnModes[number] = "repeated", ttlSeconds?: number) {
  const saved = cdnDesign(mode, ttlSeconds), adapted = prepare(saved);
  const contract = withRunLength(adapted.contract, 12, "cdn-ttl-proof");
  const result = compileProduct(saved, contract); if (!result.ok) throw Error(JSON.stringify(result));
  return { saved, contract, compiled: result.value, assumptions: adapted.assumptions, runtime: createProductModel2(result.value) };
}

export function cdnStackedSetup() {
  const f = productFixture();
  Object.assign(f.design.resources.find(r => r.id === "lb")!, { lbAdmission: { version: 1, maxActive: 1000, maxQueued: 100, queueWaitMs: 10 } });
  Object.assign(f.design.resources.find(r => r.id === "vm")!, { vmExecution: { version: 1, workers: 2, queuedRequests: 100 } });
  Object.assign(f.design.resources.find(r => r.id === "queue")!, { asyncQueue: { enabled: false, capacityMessages: 100 } });
  f.contract.version += "/lb-admission/1/vm-execution/1/queue-capacity/1";
  const c = compileProduct(f.design, f.contract); if (!c.ok) throw Error(JSON.stringify(c));
  return { contract: f.contract, compiled: c.value, assumptions: f.q.ledger, runtime: createProductModel2(c.value) };
}
