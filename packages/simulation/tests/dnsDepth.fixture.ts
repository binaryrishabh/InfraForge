import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { prepare } from "./asyncCanvas.fixture";
import { withRunLength } from "../src/model2/product/runContract";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";

export function dnsDesign(maxTtlSeconds?: number, mode: "vm" | "cdn" = "vm"): SavedProductDesign {
  const resources: Resource[] = [{ id: "dns", type: "DNS", x: 0, y: 0 },
    ...(mode === "vm" ? [{ id: "app", type: "Virtual Machine" as const, x: 1, y: 0 }]
      : [{ id: "app", type: "CDN" as const, x: 1, y: 0 }, { id: "store", type: "Object Storage" as const, x: 2, y: 0 }])];
  if (maxTtlSeconds !== undefined) Object.assign(resources[0]!, { dnsCachePolicy: { version: 1, maxTtlSeconds } });
  const links = [["dns", "app"], ...(mode === "cdn" ? [["app", "store"]] : [])];
  return { schema: "infraforge-saved-design/1", resources,
    connections: links.map(([s, t], i) => ({ id: `e${i}`, sourceId: s!, targetId: t!, sourceType: resources.find(r => r.id === s)!.type, targetType: resources.find(r => r.id === t)!.type, port: RESOURCE_PORTS[resources.find(r => r.id === t)!.type] })),
    workload: { targetThroughput: 120, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light" } };
}
export function dnsSetup(maxTtlSeconds?: number, mode: "vm" | "cdn" = "vm") {
  const saved = dnsDesign(maxTtlSeconds, mode), adapted = prepare(saved), contract = withRunLength(adapted.contract, 12, "dns-depth-proof");
  const c = compileProduct(saved, contract); if (!c.ok) throw Error(JSON.stringify(c));
  return { saved, contract, compiled: c.value, assumptions: adapted.assumptions, runtime: createProductModel2(c.value) };
}
