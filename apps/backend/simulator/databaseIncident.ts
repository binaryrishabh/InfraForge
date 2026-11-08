import type { DatabaseIncidentSample } from "@infraforge/contracts/actions";
import type { SimulationInstance } from "./instance";

// Retain existing engine measurements at action boundaries; never synthesize them.
export function databaseIncidentSample(instance: SimulationInstance, resourceId: string): DatabaseIncidentSample {
  const view = instance.model2.view(), replication = view.metrics[resourceId]?.databaseReplication;
  return {simulatedSecond: view.simulatedSeconds, overallHealth: view.overallHealth, ...(replication ? {replication: structuredClone(replication)} : {}),
    completed: view.traffic?.wholeRun?.completed ?? null, failed: view.traffic?.wholeRun?.failed ?? null};
}
