import type { WholeRunMetrics } from "@infraforge/contracts/telemetry";
import type { CausalObserver } from "../workload/causal";
import { LatencyHistogram } from "../workload/latencyHistogram";

export function wholeRunEvidence() {
  const histogram = new LatencyHistogram();
  let inFlight = 0, failed = 0, deadlineExceeded = 0, abandoned = 0;
  const observe: CausalObserver = event => {
    if (event.kind === "caller-offered") inFlight++;
    if (event.kind !== "caller-terminal") return;
    inFlight--;
    if (event.detail.outcome === "completed") histogram.record(event.detail.responseUs as number);
    else if (event.detail.outcome === "deadline-exceeded") deadlineExceeded++;
    else if (event.detail.outcome === "abandoned") abandoned++;
    else failed++;
  };
  return { observe, measure(throughSecond: number): WholeRunMetrics {
    const percentile = (p: 0.5 | 0.95 | 0.99) => {
      const bucket = histogram.percentile(p);
      return bucket ? { lowMs: bucket.lowUs / 1000, highMs: bucket.highUs / 1000 } : null;
    };
    return { version: 1, throughSecond, completed: histogram.count, failed, deadlineExceeded, abandoned, inFlight,
      minMs: histogram.minUs === null ? null : histogram.minUs / 1000, maxMs: histogram.maxUs === null ? null : histogram.maxUs / 1000,
      percentiles: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) },
      resolution: "log-linear-32/1", relativeErrorBound: 0.03125, window: "whole run from start through this second" };
  } };
}
