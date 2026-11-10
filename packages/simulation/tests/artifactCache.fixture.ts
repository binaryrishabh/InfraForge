import { resolveWorkload } from "@infraforge/domain/workload";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";

export function artifactDesign(): SavedProductDesign {
  return {
    schema: "infraforge-saved-design/1",
    resources: [
      { id: "lb", type: "Load Balancer", x: 0, y: 0, lbHealth: { version: 1, intervalSeconds: 1, timeoutSeconds: 1 } },
      { id: "app", type: "Virtual Machine", size: "small", x: 256, y: 0,
        autoscaling: { enabled: true, minReplicas: 1, maxReplicas: 2, targetCpu: 50 } },
    ],
    connections: [{ id: "lb-app", sourceId: "lb", targetId: "app", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80 }],
    workload: resolveWorkload({ targetThroughput: 12000, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light" }),
  };
}
export function artifactSetup(saved = artifactDesign()) {
  const adapted = contractFromDesign(saved);
  if ("refused" in adapted) throw Error(JSON.stringify(adapted.refused));
  const result = compileProduct(saved, adapted.contract);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return { saved, ...adapted, compiled: result.value };
}
