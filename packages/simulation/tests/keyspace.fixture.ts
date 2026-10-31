import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { createHash } from "node:crypto";

export function keyspaceDesign(count?: number): SavedProductDesign {
  const resources: Resource[] = [
    { id: "app", type: "Virtual Machine", x: 0, y: 0 },
    { id: "cache", type: "Cache", x: 0, y: 0 },
    { id: "db", type: "Database", x: 0, y: 0, ...(count === undefined ? {} : { dataKeyspace: { version: 1, count } }) },
  ];
  return { schema: "infraforge-saved-design/1", resources,
    connections: [["app", "cache"], ["cache", "db"]].map(([s, t], i) => ({ id: `edge-${i}`, sourceId: s!, targetId: t!, sourceType: resources.find(r => r.id === s)!.type, targetType: resources.find(r => r.id === t)!.type, port: RESOURCE_PORTS[resources.find(r => r.id === t)!.type] })),
    workload: { targetThroughput: 600, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 0.8, payloadSize: "light" } };
}
export const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value).replaceAll("\r\n", "\n")).digest("hex");
export function prepareKeyspace(design = keyspaceDesign(), seed?: string) {
  const built = contractFromDesign(design);
  if ("refused" in built) throw Error(JSON.stringify(built.refused));
  if (seed) built.contract.seed = seed;
  const compiled = compileProduct(design, built.contract);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const runtime = createProductModel2(compiled.value);
  return { ...built, compiled: compiled.value, runtime };
}
