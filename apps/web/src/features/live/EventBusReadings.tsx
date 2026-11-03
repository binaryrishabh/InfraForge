import type { ResourceMetrics } from "@infraforge/contracts/telemetry";
const fields = [["accepted", "Accepted"], ["delivered", "Delivered to queue"], ["retried", "Retries"], ["discarded", "Discarded (including full subscription)"], ["filtered", "Filtered"], ["pending", "Pending"], ["deadLettered", "Dead letters"], ["deadLetterOverflow", "Dead-letter overflow discards"]] as const;
export function EventBusReadings({ metrics }: { metrics?: ResourceMetrics["eventBus"] }) {
  return <section aria-label="Event bus measurements" className="border-b border-line px-4 py-4 text-sm">
    <p>Published events: {metrics?.accepted ?? "Unknown"}</p>
    {metrics?.subscriptions.map(s => <div key={s.id} className="mt-3"><p>Subscription {s.id} → {s.target}</p><dl>{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{s[key]}</dd></div>)}</dl></div>) ?? <p>Subscriptions: Unknown</p>}
    <p className="mt-2 text-xs text-ink-3">Delivery confirms queue logical ownership. Worker effects are measured separately; retries can duplicate delivery. Ordering and physical durability are Unknown.</p>
  </section>;
}
