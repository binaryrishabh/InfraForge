import type { AsyncQueueMetrics } from "@infraforge/contracts/telemetry";
import { DEFAULT_ASYNC_QUEUE_SETTINGS, DEFAULT_ASYNC_WORKER_SETTINGS, asyncSettingsError, type Resource } from "@infraforge/domain/resource";
import { Switch } from "@/ui/Switch";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { queueMetricText } from "./queueMetricText";

export function AsyncSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const metrics = useSimulationStore((s) => s.metrics[resource.id]?.asyncQueue);
  const queue = resource.type === "Message Queue", policy = queue ? resource.asyncQueue : resource.asyncWorker;
  const commit = (patch: Record<string, number | boolean | undefined>) => updateResource(resource.id, queue
    ? { asyncQueue: { ...resource.asyncQueue, enabled: policy?.enabled ?? false, ...patch } }
    : { asyncWorker: { ...resource.asyncWorker, enabled: policy?.enabled ?? false, ...patch } });
  const fields = queue ? [["visibilityTimeoutSeconds", "Visibility timeout (seconds)", 1, 3600], ["maxReceives", "Maximum deliveries before dead-lettering", 1, 10], ["retentionSeconds", "Message retention (seconds)", 1, 86400], ["deadLetterCapacity", "Dead-letter list size", 0, 1000]] as const
    : [["concurrency", "Jobs in parallel", 1, 64], ["prefetch", "Prefetch credit (leased jobs)", 1, 64], ["cpuMsPerJob", "CPU milliseconds per job (authored assumption)", 1, 120000], ["badJobPercent", "Share of uploads that can never be processed", 0, 100]] as const;
  const error = asyncSettingsError(resource.type, resource.asyncQueue, resource.asyncWorker);
  return <InspectorSection title={queue ? "Upload queue" : "Background worker"}>
    <Switch label={queue ? "Process uploads asynchronously" : "Use this VM as a worker"} checked={policy?.enabled === true} disabled={disabled}
      onChange={(enabled) => commit(enabled ? { ...(queue ? DEFAULT_ASYNC_QUEUE_SETTINGS : DEFAULT_ASYNC_WORKER_SETTINGS), ...policy, enabled: true } : { enabled: false })}
      description={queue ? "Connect app → queue → worker. Connect both VMs to the same Object Storage." : "Enable the connected queue; this VM polls for jobs, reads uploads, spends CPU, writes results and acknowledges."} />
    {policy?.enabled && <div className="mt-4 flex flex-col gap-4">
      {fields.map(([key, label, min, max]) => <Field key={key} label={label}>{({ id }) => <Input id={id} type="number" min={min} max={max} step={1} disabled={disabled}
        value={(policy as unknown as Record<string, number>)[key] ?? ""} placeholder="Unknown"
        onChange={(e) => commit({ [key]: e.target.value === "" ? undefined : Number(e.target.value) })} />}</Field>)}
      {error && <p role="alert">{error}</p>}
      <p className="text-xs text-ink-3">A job that outlives its visibility timeout can be delivered again and may write duplicate results. Bad uploads read and spend CPU on every attempt, then immediately nack; their redelivery does not wait for lease expiry. The share uses the run seed and upload identity, so a finite run may differ from the chosen percentage. Dead-lettered jobs remain in a bounded internal list; when full, overflow is discarded and counted. Worker scaling and redrive are unavailable.</p>
      {queue && <AsyncQueueReadings metrics={metrics} />}
    </div>}
  </InspectorSection>;
}

export function AsyncQueueReadings({ metrics }: { metrics?: AsyncQueueMetrics }) {
  const failures = metrics?.version === 2 ? metrics : undefined;
  const values: Partial<Record<string, number | null>> = { ...metrics, failedAttempts: failures?.failedAttempts, deadLetterOverflowDiscards: failures?.deadLetterOverflowDiscards, wastedCpuSeconds: failures?.wastedCpuSeconds };
  return <dl aria-label="Live upload journey" className="text-sm">
    {([["published", "Accepted uploads"], ["completed", "Finished jobs (includes duplicate processing)"], ["readyDepth", "Ready messages"], ["oldestReadyAgeSeconds", "Oldest ready message age (seconds)"], ["inFlight", "In flight"], ["redeliveries", "Redeliveries"], ["deadLettered", "Dead-lettered"], ["failedAttempts", "Failed attempts (worker nacks sent)"], ["deadLetterOverflowDiscards", "Dead-letter overflow discards"], ["wastedCpuSeconds", "CPU seconds spent on failed attempts"]] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{queueMetricText(values[key])}</dd></div>)}
  </dl>;
}
