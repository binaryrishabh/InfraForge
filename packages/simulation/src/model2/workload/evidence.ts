import { utf8Bytes } from "../time";
import type { CallerOutcome, CallerResult } from "./contracts";
import { HISTOGRAM_BUCKETS, EMPIRICAL_QUANTILES } from "./policy";

const outcomes: CallerOutcome[] = ["completed", "rejected", "deadline-exceeded", "abandoned"];
// Log2 integer buckets cover safe integer microseconds. No observations are discarded.
export class ResultBook {
  readonly raw: CallerResult[] = [];
  private groups = new Map<string, { operation: string; outcome: CallerOutcome; count: number; sum: number; min: number; max: number; bins: number[] }>();
  private rawBytes = 0;
  constructor(readonly rawLimit: number, readonly byteLimit = Infinity, readonly groupLimit = Infinity) {}
  record(result: CallerResult) {
    if (!Number.isSafeInteger(result.responseUs) || result.responseUs < 0) throw new Error("Latency must be safe integer microseconds");
    const key = JSON.stringify([result.operation, result.outcome]);
    let group = this.groups.get(key);
    if (!group) {
      if (this.groups.size >= this.groupLimit) throw new Error("Executor reducer cardinality budget exhausted");
      group = { operation: result.operation, outcome: result.outcome, count: 0, sum: 0, min: Infinity, max: 0, bins: Array(HISTOGRAM_BUCKETS).fill(0) };
      this.groups.set(key, group);
    }
    group.count++; group.sum += result.responseUs; group.min = Math.min(group.min, result.responseUs); group.max = Math.max(group.max, result.responseUs);
    // log2(MAX_SAFE_INTEGER) can round to 53 in IEEE-754; clamp its last bucket.
    group.bins[result.responseUs === 0 ? 0 : Math.min(HISTOGRAM_BUCKETS - 1, 1 + Math.floor(Math.log2(result.responseUs)))]!++;
    if (this.raw.length < this.rawLimit) {
      const bytes = this.byteLimit === Infinity ? 0 : utf8Bytes(JSON.stringify(result));
      if (this.rawBytes + bytes <= this.byteLimit) { this.raw.push(result); this.rawBytes += bytes; }
    }
  }
  summary() {
    return [...this.groups.values()].sort((a, b) => a.operation < b.operation ? -1 : a.operation > b.operation ? 1 : outcomes.indexOf(a.outcome) - outcomes.indexOf(b.outcome)).map((g) => {
      const exact = this.raw.filter((r) => r.operation === g.operation && r.outcome === g.outcome).map((r) => r.responseUs).sort((a, b) => a - b);
      const percentiles = EMPIRICAL_QUANTILES.map((p) => {
        // At least one expected observation beyond the requested empirical quantile.
        if (g.count < Math.round(1 / (1 - p))) return { p, kind: "unknown" as const, reason: "Insufficient terminal samples for this tail rank" };
        const rank = Math.ceil(p * g.count);
        if (exact.length === g.count) return { p, kind: "exact" as const, valueUs: exact[rank - 1]!, method: "empirical-nearest-rank" };
        let seen = 0, bucket = 0;
        for (; bucket < g.bins.length; bucket++) { seen += g.bins[bucket]!; if (seen >= rank) break; }
        return { p, kind: "bounded" as const, minUs: bucket === 0 ? 0 : 2 ** (bucket - 1), maxUs: bucket === 0 ? 0 : 2 ** bucket - 1, method: "log2-histogram-rank" };
      });
      return { operation: g.operation, outcome: g.outcome, count: g.count, minUs: g.min, maxUs: g.max,
        meanUs: g.sum / g.count, percentiles, histogram: { unit: "us", counts: [...g.bins], layout: "0 then [2^(i-1),2^i-1]" } };
    });
  }
}
