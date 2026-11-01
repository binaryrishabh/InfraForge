/** Agent-owned observation policy; omission keeps historical settings. */
interface MonitoringCadence { collectionIntervalSeconds?: number; exportIntervalSeconds?: number }
export type MonitoringPolicy = (MonitoringCadence & { version: 1 }) | (MonitoringCadence & { version: 2; bufferSamples: number; batchSamples: number; exportAttempts: number });
export const MONITORING_CADENCE_MAX_SECONDS = 60;
export const MONITORING_BUFFER_MAX_SAMPLES = 8192;
export const MONITORING_EXPORT_MAX_ATTEMPTS = 10;
export const MONITORING_BUFFER_HELP = "How many collected observations the agent can keep locally while waiting to export. When the buffer is full, new observations are dropped.";
export const MONITORING_BATCH_HELP = "Maximum observations sent in one export batch.";
export const MONITORING_ATTEMPTS_HELP = "How many times the agent may try to export an unconfirmed batch before giving it up.";
export const MONITORING_COLLECTION_HELP = "How often this monitoring agent asks each connected target for a new observation.";
export const MONITORING_EXPORT_HELP = "How often buffered observations are sent toward the monitoring backend.";
export const MONITORING_CADENCE_SCOPE = "These are educational monitoring timings, not a cloud-provider guarantee.";

export function monitoringPolicyError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Monitoring Agent") return "Monitoring policy belongs to a Monitoring Agent.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Monitoring policy requires version 1 or 2.";
  const p = value as Record<string, unknown>;
  const fields = ["version", "collectionIntervalSeconds", "exportIntervalSeconds", ...(p.version === 2 ? ["bufferSamples", "batchSamples", "exportAttempts"] : [])];
  if ((p.version !== 1 && p.version !== 2) || Object.keys(p).some(k => !fields.includes(k))) return "Monitoring policy requires a supported version with only its own fields.";
  for (const field of ["collectionIntervalSeconds", "exportIntervalSeconds"]) {
    const seconds = p[field];
    if (seconds !== undefined && (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > MONITORING_CADENCE_MAX_SECONDS)) return `Monitoring cadence must be an integer from 1 to ${MONITORING_CADENCE_MAX_SECONDS} seconds.`;
  }
  if (p.version === 2) {
    for (const [field, max] of [["bufferSamples", MONITORING_BUFFER_MAX_SAMPLES], ["batchSamples", typeof p.bufferSamples === "number" ? p.bufferSamples : 0], ["exportAttempts", MONITORING_EXPORT_MAX_ATTEMPTS]] as const) {
      const n = p[field];
      if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1 || n > max) return `Monitoring ${field} must be an integer from 1 to ${max}.`;
    }
  }
}
