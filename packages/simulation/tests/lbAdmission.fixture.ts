import type { Resource } from "@infraforge/domain/resource";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { prepareKeyspace } from "./keyspace.fixture";

export function lbDesign(): SavedProductDesign {
  const resources: Resource[] = [
    { id: "lb", type: "Load Balancer", x: 0, y: 0 },
    { id: "app", type: "Virtual Machine", x: 1, y: 0, size: "large" },
  ];
  return { schema: "infraforge-saved-design/1", resources,
    connections: [{ id: "backend", sourceId: "lb", sourceType: "Load Balancer", targetId: "app", targetType: "Virtual Machine", port: 80 }],
    workload: { targetThroughput: 72000, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light" } };
}
export const prepareLb = (design = lbDesign()) => prepareKeyspace(design, "lb-admission-proof");
