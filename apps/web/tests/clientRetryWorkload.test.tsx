import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ClientRetryControls } from "../src/features/deployment/components/ClientRetryControls";
import { WORKLOAD_PRESETS, withClientRetry } from "../src/features/deployment/workloadOptions";
import { SourceInputFacts } from "../src/features/reports/components/SourceInputFacts";
import { describeWorkload } from "../src/lib/format";
import { TrafficReadings } from "../src/features/live/TrafficReadings";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";

test("retry choices preserve presets, turn fully off, show exact backoff and obey deploy locks", () => {
  expect(WORKLOAD_PRESETS.every(p => !Object.hasOwn(p.profile, "clientRetry"))).toBe(true);
  const original = WORKLOAD_PRESETS[0]!.profile, on = withClientRetry(original, 3);
  expect(on.clientRetry).toEqual({ version: 1, maxAttempts: 3, backoffMs: 200 });
  expect(withClientRetry(on, 4, 50).clientRetry).toEqual({ version: 1, maxAttempts: 4, backoffMs: 50 });
  expect(withClientRetry(on, 0)).not.toHaveProperty("clientRetry");
  expect(original).not.toHaveProperty("clientRetry");
  const html = renderToStaticMarkup(<ClientRetryControls profile={on} onChange={() => {}} disabled />);
  for (const text of ["Client retries", "Off", "2 attempts", "3 attempts", "4 attempts", "50 ms", "200 ms", "1000 ms", "Clients retry rejected reads after a delay. Retries add load, so an overloaded system can get worse. Writes and rate-limited requests are not retried."]) expect(html).toContain(text);
  expect(html.match(/disabled=""/g)).toHaveLength(7);
  const custom = renderToStaticMarkup(<ClientRetryControls profile={withClientRetry(on, 3, 17)} onChange={() => {}} disabled={false} />);
  expect(custom).toContain("17 ms");
});

test("descriptions and source facts show captured retry policy or none", () => {
  for (const attempts of [0, 2, 3, 4]) {
    const workload = withClientRetry(WORKLOAD_PRESETS[0]!.profile, attempts, 1000);
    const text = attempts ? `Client retries: up to ${attempts} attempts, backoff 1000 ms, reads only` : "Client retries: none";
    expect(describeWorkload(workload)).toContain(text);
    expect(renderToStaticMarkup(<SourceInputFacts workload={workload} seed="retry-seed" />)).toContain(text);
  }
});

test("live readout shows retry attempts separately and stays absent historically", () => {
  const initial = useSimulationStore.getInitialState(), previous = initial.traffic;
  try {
    initial.traffic = { offeredRps: 10, completedRps: 8, failedRps: 2, latencyMs: { p50: 30, p95: 80, p99: 90 } };
    expect(renderToStaticMarkup(<TrafficReadings />)).not.toContain("Client retry load");
    initial.traffic.clientRetry = { attemptRps: 24, originalsOffered: 10, totalAttempts: 24, retriesScheduled: 14, retriesIssued: 14, recovered: 3, exhausted: 2, givenUp: 0, ineligibleByReason: {}, extraLoadFactor: 2.4, perAttemptOutcomes: [] };
    const html = renderToStaticMarkup(<TrafficReadings />);
    for (const text of ["Client retry load", "Attempts/s", "24", "Retries issued", "14", "Recovered", "Exhausted", "2.4"]) expect(html).toContain(text);
  } finally { initial.traffic = previous; }
});
