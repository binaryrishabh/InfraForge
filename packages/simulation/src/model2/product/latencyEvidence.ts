import type { LatencyCategory, LatencyMean, LatencyMetrics } from "@infraforge/contracts/telemetry";
import type { CausalObserver } from "../workload/causal";
import { latencyComposition, type LatencySample } from "../workload/latencyComposition";

export const LATENCY_WINDOW_CAP = 10000;
const SECOND = 1000000;
type Sample = Pick<LatencySample, "responseUs" | "categoriesUs" | "unattributedUs">;
const unproven: LatencyMetrics["unproven"] = "Missing boundaries and load-balancer retry backoff remain unattributed; dependency time includes its nested network and service, without database internals.";

/** One bounded measured-second buffer, independent of retained trace/result budgets. */
export function latencyEvidence(maxLiveRoots: number, sampleCap = LATENCY_WINDOW_CAP) {
  let second = 0, samples: Sample[] = [], completedCount = 0, failedCount = 0, cancelledCount = 0, inFlightCount = 0, rootBoundaryExceededCount = 0;
  const windowFor = (atUs: number) => Math.max(1, Math.ceil(atUs / SECOND));
  const rotate = (next: number) => {
    if (next === second) return;
    second = next; samples = []; completedCount = 0; failedCount = 0; cancelledCount = 0; rootBoundaryExceededCount = 0;
  };
  const accounting = latencyComposition(maxLiveRoots, sample => {
    rotate(windowFor(sample.atUs)); completedCount++;
    if (!sample.bounded) rootBoundaryExceededCount++;
    if (completedCount <= sampleCap) samples.push({ responseUs: sample.responseUs, categoriesUs: sample.categoriesUs, unattributedUs: sample.unattributedUs });
    else samples = []; // Once exceeded, the entire window is Unknown; never retain a biased prefix.
  });
  const observe: CausalObserver = e => {
    if (e.kind === "caller-offered") inFlightCount++;
    if (e.kind === "caller-terminal") {
      rotate(windowFor(e.atUs)); inFlightCount--;
      if (e.detail.outcome === "abandoned" || e.detail.outcome === "cancelled") cancelledCount++;
      else if (e.detail.outcome !== "completed") failedCount++;
    }
    accounting.observe(e);
  };
  return { observe, measure(atUs: number) {
    if (atUs > 0) rotate(windowFor(atUs));
    const over = completedCount > sampleCap, sorted = samples.map(s => s.responseUs).sort((a, b) => a - b);
    const percentile = (p: number) => !over && sorted.length ? sorted[Math.ceil(p * sorted.length) - 1]! / 1000 : null;
    const p99Ms = percentile(0.99), threshold = sorted[Math.ceil(0.99 * sorted.length) - 1];
    const latency: LatencyMetrics = { version: 2, window: { fromUs: Math.max(0, second - 1) * SECOND, toUs: atUs },
      status: over ? "sample-cap-exceeded" : "complete", sampleCap, completedCount, failedCount, cancelledCount, inFlightCount, rootBoundaryExceededCount,
      typical: !over && samples.length ? mean(samples) : null,
      slowestOnePercent: !over && completedCount >= 100 ? mean(samples.filter(s => s.responseUs >= threshold!)) : null, p99Ms, unproven };
    return { latency, latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: p99Ms } };
  } };
}

function mean(samples: Sample[]): LatencyMean {
  const n = samples.length, responseUs = samples.reduce((sum, s) => sum + s.responseUs, 0);
  const sum: Partial<Record<LatencyCategory, number>> = {};
  for (const s of samples) for (const key of Object.keys(s.categoriesUs) as LatencyCategory[]) sum[key] = (sum[key] ?? 0) + s.categoriesUs[key]!;
  const part = (value: number) => ({ meanMs: value / n / 1000, share: responseUs > 0 ? value / responseUs : null });
  return { sampleCount: n, totalMs: responseUs / n / 1000,
    categories: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, part(v)])),
    unattributed: part(samples.reduce((sum, s) => sum + s.unattributedUs, 0)) };
}
