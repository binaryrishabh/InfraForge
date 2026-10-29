import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import type { SavedProductDesign } from "../src/model2/product/contracts";

export function securityDesign(types: Record<string, Resource["type"]> = { lb: "Load Balancer", app: "Virtual Machine", db: "Database", firewall: "Firewall" }, links = [["lb", "app"], ["app", "db"], ["firewall", "db"]]): SavedProductDesign {
  return { schema: "infraforge-saved-design/1", resources: Object.entries(types).map(([id, type]) => ({ id, type, x: 0, y: 0 })), connections: links.map(([s, t], i) => ({ id: `edge-${i}`, sourceId: s!, targetId: t!, sourceType: types[s!]!, targetType: types[t!]!, port: RESOURCE_PORTS[types[t!]!] })), workload: { targetThroughput: 600, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light" } };
}
export function prepareSecurity(d: SavedProductDesign) {
  const adapted = contractFromDesign(d);
  if ("refused" in adapted) throw Error(JSON.stringify(adapted.refused));
  const compiled = compileProduct(d, adapted.contract);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  return { ...adapted, compiled: compiled.value };
}
