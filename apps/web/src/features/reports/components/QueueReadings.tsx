import type { ReportCheckpoint } from "@infraforge/contracts/reports";

type Resource = ReportCheckpoint["resources"][number];
export function QueueReadings({ resource }: { resource: Resource }) {
  const q = resource.queueWork, observation = resource.asyncQueue;
  const readings = [["Acknowledged messages", q?.acknowledged], ["Expired messages", q?.expired],
    ["Ready messages", observation?.readyDepth], ["Oldest ready message age (seconds)", observation?.oldestReadyAgeSeconds]] as const;
  return <section aria-label={`Queue measurements for ${resource.id}`} className="mt-4">
    <h3 className="font-semibold">{resource.id}: queue measurements</h3>
    <dl className="text-sm">{readings.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value == null ? "Unknown" : value.toLocaleString(undefined, {maximumFractionDigits: 6})}</dd></div>)}</dl>
    <p className="text-xs text-ink-3">Acknowledged and expired counts cover run start through the recorded second. Ready depth and age describe this sample only. When no message is ready, its age is Unknown.</p>
  </section>;
}
