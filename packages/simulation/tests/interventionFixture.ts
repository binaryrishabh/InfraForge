import { resolveWorkload } from "@infraforge/domain/workload";
import type { Resource, InterventionRequest } from "@infraforge/domain/resource";
import { createModel2Run } from "../src/model2/product/liveRun";
export const interventionInput = (cache = false, rps = 100) => ({
  resources: [{id: "app", type: "Virtual Machine", x: 0, y: 0}, {id: "db", type: "Database", x: 1, y: 0}, ...(cache ? [{id: "cache", type: "Cache", x: 1, y: 1}] : [])] as Resource[],
  connectionLines: [{id: "app-db", sourceId: "app", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432}, ...(cache ? [{id: "app-cache", sourceId: "app", targetId: "cache", sourceType: "Virtual Machine", targetType: "Cache", port: 6379}] : [])],
  workloadProfile: resolveWorkload({targetThroughput: rps * 60, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light"}), seed: "intervention-proof",
});
export const intervention = (interventionId: string, parameters: InterventionRequest["parameters"], target: InterventionRequest["target"] = {resourceId: "db"}) => ({kind: "intervention" as const, parameters: {interventionId, revision: 1, target, parameters}});
export const advance = (run: ReturnType<typeof createModel2Run>, n: number) => { for (let s = 0; s < n; s++) run.advance(); };
