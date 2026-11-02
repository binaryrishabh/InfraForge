import type { LbRateLimitMetrics } from "@infraforge/contracts/telemetry";

export function LbRateLimitReadings({ metrics }: { metrics?: LbRateLimitMetrics }) {
  return <section aria-label="Load balancer rate limit measurements" className="border-b border-line px-4 py-4 text-sm">
    <h3 className="mb-2 font-semibold">Rate limit</h3>
    <dl>{([["Received", metrics?.received], ["Admitted", metrics?.admitted], ["Rate-limited", metrics?.rejected], ["Available tokens", metrics?.availableTokens],
      ["Sustained requests per second", metrics?.sustainedRequestsPerSecond], ["Burst capacity", metrics?.burstCapacity]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "Unknown"}</dd></div>)}</dl>
  </section>;
}
