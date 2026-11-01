import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { design as asyncDesign } from "./asyncCanvas.fixture";
import { prepareKeyspace } from "./keyspace.fixture";

export const vmModes = ["plain", "lb-db", "autoscaled", "async", "flow"] as const;
export function vmDesign(mode: typeof vmModes[number] = "plain"): SavedProductDesign {
  if (mode === "async") return asyncDesign(true, 8);
  const resources: Resource[] = [{ id: "app", type: "Virtual Machine", x: 1, y: 0 }];
  const links: string[][] = [];
  if (mode === "lb-db" || mode === "autoscaled") {
    resources.unshift({ id: "lb", type: "Load Balancer", x: 0, y: 0 });
    links.push(["lb", "app"]);
    if (mode === "lb-db") {
      resources.push({ id: "other", type: "Virtual Machine", x: 1, y: 1 });
      links.push(["lb", "other"], ["other", "db"]);
    } else resources[1]!.autoscaling = { enabled: true, minReplicas: 1, maxReplicas: 3, targetCpu: 50 };
  }
  if (mode === "lb-db" || mode === "flow") {
    resources.push({ id: "db", type: "Database", x: 2, y: 0 });
    links.push(["app", "db"]);
  }
  if (mode === "flow") resources[0]!.applicationFlow = { schema: "application-flow/2", operations: {
    read: { steps: [{ id: "read", kind: "data", edge: "app-db", operation: "read" }] },
    write: { steps: [{ id: "write", kind: "data", edge: "app-db", operation: "write" }] },
  } };
  return { schema: "infraforge-saved-design/1", resources,
    connections: links.map(([sourceId, targetId]) => ({ id: `${sourceId}-${targetId}`, sourceId: sourceId!, targetId: targetId!, sourceType: resources.find(r => r.id === sourceId)!.type, targetType: resources.find(r => r.id === targetId)!.type, port: RESOURCE_PORTS[resources.find(r => r.id === targetId)!.type] })),
    workload: { targetThroughput: 1200, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 0.8, payloadSize: "light" } };
}
export const prepareVm = (d = vmDesign()) => prepareKeyspace(d, "vm-depth1-proof");
