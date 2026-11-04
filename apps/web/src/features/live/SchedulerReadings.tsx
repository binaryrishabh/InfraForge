import type { ResourceMetrics } from "@infraforge/contracts/telemetry";
const fields = [["due", "Due triggers"], ["fired", "Attempts fired"], ["completed", "Completed invocations"], ["skippedOverlap", "Skipped overlap"], ["missed", "Missed triggers"], ["retried", "Retries"], ["failed", "Failed invocations"], ["active", "Active invocations"], ["queued", "Waiting invocations"], ["retainedLatest", "Retained latest missed trigger"]] as const;
export function SchedulerReadings({ metrics }: { metrics?: ResourceMetrics["scheduler"] }) {
  return <section aria-label="Scheduler measurements" className="border-b border-line px-4 py-4 text-sm"><dl>{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{metrics?.[key] ?? "Unknown"}</dd></div>)}</dl><p className="mt-2 text-xs text-ink-3">Completion confirms the app response. Retries may repeat an effect; destination idempotency and physical availability are Unknown.</p></section>;
}
