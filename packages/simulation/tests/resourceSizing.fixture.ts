import { CATALOG } from "@infraforge/catalog";
import type { Resource } from "@infraforge/domain/resource";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import type { SavedProductDesign } from "../src/model2/product/contracts";

export const sizingResources: Resource[] = [
  ...(["Virtual Machine", "Database"] as const).flatMap(type =>
    ([undefined, "small", "medium", "large"] as const).map(size => ({ id: "sized", type, x: 0, y: 0, ...(size ? { size } : {}) }))),
  ...CATALOG.map(sku => ({ id: "sized", type: sku.category, skuId: sku.skuId, x: 0, y: 0 })),
];

export function sizingDesign(resource: Resource): SavedProductDesign {
  const database = resource.type === "Database";
  return {
    schema: "infraforge-saved-design/1",
    resources: database ? [{ id: "app", type: "Virtual Machine", x: 0, y: 0 }, resource] : [resource],
    connections: database ? [{ id: "edge", sourceId: "app", sourceType: "Virtual Machine", targetId: resource.id, targetType: "Database", port: 5432 }] : [],
    workload: { targetThroughput: 600, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 0.8, payloadSize: "light" },
  };
}

export function prepareSizing(resource: Resource) {
  const design = sizingDesign(resource), built = contractFromDesign(design);
  if ("refused" in built) throw Error(JSON.stringify(built.refused));
  const compiled = compileProduct(design, built.contract);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  return { ...built, compiled: compiled.value };
}
