import type { WorkloadProfile } from "@infraforge/domain/workload";

/** "1 resource", "3 resources". */
export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export const formatUsd = (value: number, digits = 2) => `$${value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

// Simulated clock: t+mm:ss
export function formatClock(total: number) {
  const s = Math.max(0, Math.floor(total));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function requestsPerSecond(w: Pick<WorkloadProfile, "targetThroughput" | "throughputUnit">) {
  return w.targetThroughput / (w.throughputUnit === "per-minute" ? 60 : 3600);
}

export function describeWorkload(w: WorkloadProfile) {
  const rate = `${w.targetThroughput.toLocaleString()} requests per ${w.throughputUnit === "per-minute" ? "minute" : "hour"}`;
  const shape = w.trafficShape === "peak" ? `bursts to ${w.peakMultiplier ?? 3}×` : "steady";
  const reads = w.readWriteRatio !== undefined ? `${Math.round(w.readWriteRatio * 100)}% reads` : null;
  return [rate, shape, reads, `${w.payloadSize} payloads`].filter(Boolean).join(" · ");
}

export function formatDate(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function relativeTime(iso: string, now = Date.now()) {
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(diff)) return "unknown time";
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 14) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
