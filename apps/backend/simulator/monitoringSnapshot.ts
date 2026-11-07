import type { Model2Engine } from "./model2Engine";
import type { ResourceMetrics } from "@infraforge/contracts/telemetry";
import type { MonitoringBackendMetrics } from "@infraforge/contracts/reports";

/** Capture the independently owned backend, using the run's compiled binding.
 * Keep this out of the live projection so historical engine views stay identical. */
export function monitoringSnapshot(metrics: Record<string, ResourceMetrics>, model: Model2Engine): Record<string, ResourceMetrics & {monitoringBackend?: MonitoringBackendMetrics}> {
  if (!Object.values(metrics).some(row => row.monitoring)) return metrics;
  const evidence = model.evidence();
  return Object.fromEntries(Object.entries(metrics).map(([id, row]) => {
    if (!row.monitoring) return [id, row];
    const config = evidence.systemConfiguration.resources.find(r => r.id === id && r.kind === "monitor");
    const backend = config?.kind === "monitor" ? evidence.systems.backends.find(b => b.id === config.backend) : undefined;
    const monitoringBackend: MonitoringBackendMetrics | undefined = backend ? {version: 1, id: backend.id,
      received: backend.received, duplicates: backend.duplicates, refused: backend.refused,
      latest: backend.latest.map(r => ({...r}))} : undefined;
    return [id, {...row, ...(monitoringBackend ? {monitoringBackend} : {})}];
  }));
}
