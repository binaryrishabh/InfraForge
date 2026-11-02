import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ObjectiveMetrics } from "@infraforge/contracts/telemetry";
import { ServiceObjectiveControls } from "../src/features/deployment/components/ServiceObjectiveControls";
import { WORKLOAD_PRESETS, withObjective } from "../src/features/deployment/workloadOptions";
import { SourceInputFacts } from "../src/features/reports/components/SourceInputFacts";
import { describeWorkload, describeObjective } from "../src/lib/format";
import { TrafficReadings } from "../src/features/live/TrafficReadings";
import { ObjectiveReadings } from "../src/features/live/ObjectiveReadings";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";

test("objective controls preserve presets, exact choices and custom values, turn off and obey loading lock", () => {
  expect(WORKLOAD_PRESETS.every(p => !Object.hasOwn(p.profile, "workloadObjective"))).toBe(true);
  const original = WORKLOAD_PRESETS[0]!.profile;
  const on = withObjective(original, { maxResponseMs: 250, targetSuccessPercent: 99.9 });
  expect(on.workloadObjective).toEqual({ version: 1, maxResponseMs: 250, targetSuccessPercent: 99.9 });
  expect(original).not.toHaveProperty("workloadObjective");
  expect(withObjective(on, null)).toEqual(original);
  const html = renderToStaticMarkup(<ServiceObjectiveControls profile={on} onChange={() => {}} disabled />);
  for (const text of ["Service objective", "Off", "On", "50 ms", "100 ms", "250 ms", "500 ms", "1000 ms", "90%", "95%", "99%", "99.9%",
    "An educational objective for this run, not a provider SLA. Requests still waiting can still change the result."]) expect(html).toContain(text);
  expect(html.match(/disabled=""/g)).toHaveLength(4);
  expect(html).toContain("min-w-0"); expect(html).toContain("sm:grid-cols-2");
  const custom = withObjective(on, { maxResponseMs: 17, targetSuccessPercent: 95.123 });
  const customHtml = renderToStaticMarkup(<ServiceObjectiveControls profile={custom} onChange={() => {}} disabled={false} />);
  expect(customHtml).toContain("17 ms"); expect(customHtml).toContain("95.123%");
  const off = renderToStaticMarkup(<ServiceObjectiveControls profile={original} onChange={() => {}} disabled={false} />);
  expect(off).not.toContain("<select");
});

test("workload, report, rerun and comparison source facts describe an objective or none", () => {
  const old = WORKLOAD_PRESETS[0]!.profile;
  const on = withObjective(old, { maxResponseMs: 100, targetSuccessPercent: 99.9 });
  for (const workload of [old, on]) {
    const description = describeObjective(workload);
    expect(description).toBe(workload.workloadObjective ? "Service objective: 99.9% within 100 ms" : "Service objective: none");
    expect(describeWorkload(workload)).toContain(description);
    expect(renderToStaticMarkup(<SourceInputFacts workload={workload} seed="objective-seed" />)).toContain(description);
  }
});

const objective: ObjectiveMetrics = { version: 1, objective: { version: 1, maxResponseMs: 250, targetSuccessPercent: 95 }, throughUs: 1000000, horizonUs: 1000000,
  offered: 10, good: 9, late: 0, failed: 0, deadlineExceeded: 0, abandoned: 0, unresolvedPastThreshold: 0, pending: 1,
  status: "undetermined", measuredFraction: 0.9, worstCaseFraction: 0.9, bestCaseFraction: 1 };

test("compact cumulative readout names all statuses, bounds and original-request counts", () => {
  for (const [status, label] of [["met", "Met"], ["missed", "Missed"], ["undetermined", "Not decided yet"], ["unknown", "Unknown"]] as const) {
    const html = renderToStaticMarkup(<ObjectiveReadings objective={{ ...objective, status,
      ...(status === "unknown" ? { offered: 0, good: 0, pending: 0, measuredFraction: null, worstCaseFraction: null, bestCaseFraction: null } : {}) }} />);
    for (const text of ["Service objective", label, "Measured in time", "Worst case", "Best case", "Original requests", "In time", "Late", "Failed", "Deadline exceeded", "Abandoned", "Past threshold but unresolved", "Still pending"]) expect(html).toContain(text);
    if (status === "unknown") expect(html).not.toContain("(0%)");
    else { expect(html).toContain("9/10"); expect(html).toContain("10/10"); expect(html).toContain("90%"); }
    expect(html).toContain("sm:grid-cols-4");
  }
});

test("traffic readout includes the objective only on captured runs", () => {
  const initial = useSimulationStore.getInitialState(), previous = initial.traffic;
  try {
    initial.traffic = { offeredRps: 10, completedRps: 9, failedRps: 0, latencyMs: { p50: 30, p95: 80 } };
    expect(renderToStaticMarkup(<TrafficReadings />)).not.toContain("Service objective");
    initial.traffic.objective = objective;
    expect(renderToStaticMarkup(<TrafficReadings />)).toContain("Not decided yet");
  } finally { initial.traffic = previous; }
});
