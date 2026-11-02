import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { LatencyMetrics } from "@infraforge/contracts/telemetry";
import { TrafficReadings } from "../src/features/live/TrafficReadings";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";

const measured: LatencyMetrics = { version: 2, window: { fromUs: 0, toUs: 1000000 }, status: "complete", sampleCap: 10000,
  completedCount: 100, failedCount: 3, cancelledCount: 2, inFlightCount: 4, rootBoundaryExceededCount: 0, p99Ms: 20,
  typical: { sampleCount: 100, totalMs: 10, categories: { applicationQueue: { meanMs: 6, share: 0.6 } }, unattributed: { meanMs: 4, share: 0.4 } },
  slowestOnePercent: { sampleCount: 2, totalMs: 20, categories: { applicationQueue: { meanMs: 16, share: 0.8 } }, unattributed: { meanMs: 4, share: 0.2 } },
  unproven: "Missing boundaries and load-balancer retry backoff remain unattributed; dependency time includes its nested network and service, without database internals." };
function html(latency?: LatencyMetrics) {
  const state = useSimulationStore.getInitialState(), before = state.traffic;
  try {
    state.traffic = { offeredRps: 105, completedRps: 100, failedRps: 5, latencyMs: { p50: 9, p95: 18, p99: 20 }, ...(latency ? { latency } : {}) };
    return renderToStaticMarkup(<TrafficReadings />);
  } finally { state.traffic = before; }
}
test("learner sees exclusive measured means, shares, population counts and mobile-safe table", () => {
  const markup = html(measured);
  for (const text of ["Where completed requests spent their time", "Typical request", "Slowest 1%", "Application queue wait", "Not attributed", "6 ms", "60%", "16 ms", "80%", "Completed: 100", "Failed: 3", "Stopped: 2", "In flight: 4", "100 requests", "2 requests",
    "Times are exclusive: each request&#x27;s response time is split into non-overlapping parts. Slowest 1% means requests at or above this window&#x27;s p99."]) expect(markup).toContain(text);
  expect(markup).toContain("overflow-x-auto"); expect(markup).toContain('scope="col"'); expect(markup).toContain('scope="row"');
  expect(markup).not.toContain("Database service");
});
test("historical traffic has no breakdown; sparse and over-cap windows render Unknown", () => {
  expect(html()).not.toContain("Where completed requests spent their time");
  let markup = html({ ...measured, completedCount: 99, slowestOnePercent: null });
  expect(markup).toContain("at least 100 completed requests"); expect(markup).toContain("Unknown");
  markup = html({ ...measured, status: "sample-cap-exceeded", completedCount: 10001, typical: null, slowestOnePercent: null, p99Ms: null });
  expect(markup).toContain("10000"); expect(markup).toContain("Unknown"); expect(markup).not.toContain("6 ms");
});
