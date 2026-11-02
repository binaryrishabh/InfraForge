import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ClientRetryControls } from "../src/features/deployment/components/ClientRetryControls";
import { WORKLOAD_PRESETS, withClientRetry } from "../src/features/deployment/workloadOptions";
import { SourceInputFacts } from "../src/features/reports/components/SourceInputFacts";
import { describeClientRetry } from "../src/lib/format";
import { TrafficReadings } from "../src/features/live/TrafficReadings";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";

test("timeout choices preserve custom captured intent, turn fully off and obey locks", () => {
  const original = WORKLOAD_PRESETS[0]!.profile;
  const on = withClientRetry(original, 3, 50, 173);
  expect(on.clientRetry!.attemptTimeoutMs).toBe(173);
  expect(withClientRetry(on, 4, 200).clientRetry!.attemptTimeoutMs).toBe(173);
  expect(withClientRetry(on, 3, 50, null).clientRetry).not.toHaveProperty("attemptTimeoutMs");
  expect(withClientRetry(on, 0)).not.toHaveProperty("clientRetry");
  const html = renderToStaticMarkup(<ClientRetryControls profile={on} onChange={() => {}} disabled />);
  for (const text of ["Attempt timeout", "100 ms", "500 ms", "2000 ms", "173 ms", "A client gives up on a slow attempt", "Abandoned work that still finishes is wasted load", "final attempt"]) expect(html).toContain(text);
  expect(html.match(/disabled=""/g)).toHaveLength(12);
  expect(renderToStaticMarkup(<ClientRetryControls profile={original} onChange={() => {}} disabled={false} />)).not.toContain("Attempt timeout");
  const description = describeClientRetry(on);
  expect(description).toContain("attempt timeout 173 ms");
  expect(renderToStaticMarkup(<SourceInputFacts workload={on} seed="timeout" />)).toContain(description);
  expect(WORKLOAD_PRESETS.every(p => !p.profile.clientRetry)).toBe(true);
});

test("timeout readouts stay absent historically and missing measurements stay Unknown", () => {
  const initial = useSimulationStore.getInitialState(), previous = initial.traffic;
  try {
    initial.traffic = { offeredRps: 10, completedRps: 8, failedRps: 2, latencyMs: { p50: null, p95: null },
      clientRetry: { attemptRps: 20, originalsOffered: 10, totalAttempts: 20, retriesScheduled: 10, retriesIssued: 10, recovered: 3, exhausted: 2, givenUp: 0, ineligibleByReason: {}, extraLoadFactor: 2, perAttemptOutcomes: [] } };
    expect(renderToStaticMarkup(<TrafficReadings />)).not.toContain("Timed-out attempts");
    initial.traffic.clientRetry!.attemptsTimedOut = 7;
    let html = renderToStaticMarkup(<TrafficReadings />);
    expect(html).toContain("Timed-out attempts"); expect(html).toContain("Wasted completions");
    expect(html).toMatch(/Wasted completions<\/dt><dd>Unknown<\/dd>/);
    Object.assign(initial.traffic.clientRetry!, { wastedCompletions: 2, timeoutCancellationsRequested: 5, timeoutCancellationsConfirmed: 4, recoveredByTimeoutRetry: 3 });
    html = renderToStaticMarkup(<TrafficReadings />);
    for (const text of ["Timeout cancellations requested", "Confirmed at entry", "Recovered after timeout"]) expect(html).toContain(text);
    expect(html).toMatch(/Wasted completions<\/dt><dd>2<\/dd>/);
  } finally { initial.traffic = previous; }
});
