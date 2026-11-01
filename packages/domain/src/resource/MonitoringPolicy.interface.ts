/** Agent-owned collection and export cadence; omission keeps historical timings. */
export interface MonitoringPolicy { version: 1; collectionIntervalSeconds?: number; exportIntervalSeconds?: number }
export const MONITORING_CADENCE_MAX_SECONDS = 60;
export const MONITORING_COLLECTION_HELP = "How often this monitoring agent asks each connected target for a new observation.";
export const MONITORING_EXPORT_HELP = "How often buffered observations are sent toward the monitoring backend.";
export const MONITORING_CADENCE_SCOPE = "These are educational monitoring timings, not a cloud-provider guarantee.";

export function monitoringPolicyError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Monitoring Agent") return "Monitoring cadence belongs to a Monitoring Agent.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Monitoring cadence requires version 1.";
  const p = value as Record<string, unknown>;
  if (p.version !== 1 || Object.keys(p).some(k => !["version", "collectionIntervalSeconds", "exportIntervalSeconds"].includes(k))) return "Monitoring cadence requires version 1 with only collection and export intervals.";
  for (const field of ["collectionIntervalSeconds", "exportIntervalSeconds"]) {
    const seconds = p[field];
    if (seconds !== undefined && (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > MONITORING_CADENCE_MAX_SECONDS)) return `Monitoring cadence must be an integer from 1 to ${MONITORING_CADENCE_MAX_SECONDS} seconds.`;
  }
}
