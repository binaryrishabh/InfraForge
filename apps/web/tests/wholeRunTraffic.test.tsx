import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { WholeRunMetrics } from "@infraforge/contracts/telemetry";
import { TrafficEvidence } from "../src/features/live/TrafficEvidence";
import { recordedTraffic } from "./reportTraffic.fixture";

const wholeRun: WholeRunMetrics = { version: 1, throughSecond: 5, completed: 99, failed: 2, deadlineExceeded: 3, abandoned: 4, inFlight: 5,
  minMs: 1, maxMs: 8, percentiles: { p50: { lowMs: 2, highMs: 2.047 }, p95: { lowMs: 4, highMs: 4.095 }, p99: null },
  resolution: "log-linear-32/1", relativeErrorBound: 0.03125, window: "whole run from start through this second" };

test("live and report label cumulative bounds, original counts and Unknown separately from last second", () => {
  for (const recordedAt of [undefined, "stop", "checkpoint"] as const) {
    const html = renderToStaticMarkup(<TrafficEvidence traffic={{ ...recordedTraffic, wholeRun }} recordedAt={recordedAt} />);
    expect(html).toContain(recordedAt ? "Whole run (through second 5)" : "Whole run so far");
    for (const text of ["within 3%", "2.047 ms", "4.095 ms", "Unknown", "Completed", "Deadline exceeded", "Abandoned", "In-flight",
      "Percentiles of every completed request since the run started.", "Last measured second"]) expect(html).toContain(text);
  }
});

test("historical traffic retains its exact markup", () => {
  const old = renderToStaticMarkup(<TrafficEvidence traffic={recordedTraffic} />);
  const explicitMissing = renderToStaticMarkup(<TrafficEvidence traffic={{ ...recordedTraffic, wholeRun: undefined }} />);
  expect(old).toBe(explicitMissing); expect(old).not.toContain("Whole run so far");
});
