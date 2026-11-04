import type { Resource } from "@infraforge/domain/resource";
export const schedulerWorkload = { targetThroughput: 60, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 1, payloadSize: "light" as const };
export function schedulerLayout() {
  return { resources: [{ id: "app", type: "Virtual Machine", x: 0, y: 0 }, { id: "timer", type: "Scheduler", x: 200, y: 0, scheduler: { version: 1, periodMs: 10, maxTriggers: 100 } }] as Resource[], connectionLines: [{ id: "tick", sourceId: "timer", targetId: "app", sourceType: "Scheduler" as const, targetType: "Virtual Machine" as const, port: 80 }] };
}
