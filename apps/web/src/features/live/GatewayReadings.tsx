import type { ResourceMetrics } from "@infraforge/contracts/telemetry";
const fields = [["received", "Received"], ["completed", "Completed"], ["invalid", "Invalid request (400)"], ["missingRoute", "Missing route (404)"], ["throttled", "Route throttles (429)"], ["overloaded", "Capacity refusals (503)"], ["gatewayFailed", "Gateway failures (503)"], ["upstreamFailed", "Upstream failures (502)"], ["timedOut", "Ambiguous timeouts (504)"], ["pending", "Pending"]] as const;
export function GatewayReadings({ metrics }: { metrics?: ResourceMetrics["gateway"] }) {
  return <section aria-label="Gateway measurements" className="border-b border-line px-4 py-4 text-sm">
    <dl>{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{metrics?.[key] ?? "Unknown"}</dd></div>)}</dl>
    {metrics?.routes.map(r => <div key={r.id} className="mt-3"><p>{r.method} {r.path} → {r.target}</p><dl>
      <div><dt>Admitted</dt><dd>{r.admitted}</dd></div><div><dt>Throttled</dt><dd>{r.rejected}</dd></div><div><dt>Available credits</dt><dd>{r.tokens}</dd></div>
    </dl></div>) ?? <p>Route budgets: Unknown</p>}
    <p className="mt-2 text-xs text-ink-3">Budgets are independent per route. A timeout may follow an upstream effect. Authentication and provider timings are Unknown.</p>
  </section>;
}
