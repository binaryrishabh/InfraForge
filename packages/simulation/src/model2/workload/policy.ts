import type { RealityEntry } from "../../reality/ledger";
import type { Unit } from "../../reality/quantity";

// Execution/observation guards are engineering policy, never infrastructure capacity.
export const WORKLOAD_LIMITS = { resources: 256, operations: 64, sources: 256, profiles: 16384, faults: 1024, samples: 10000, events: 10000000, requests: 1000000, traceRows: 100000, identityCharacters: 256 } as const;
export const HISTOGRAM_BUCKETS = 54;
export const EMPIRICAL_QUANTILES = [0.5, 0.95, 0.99, 0.999] as const;
export const TRACE_IMPORT_LIMITS = { maxRows: WORKLOAD_LIMITS.traceRows, maxLineBytes: 65536, maxBytes: 16777216 } as const;
export const WORKLOAD_POLICY_LEDGER: RealityEntry[] = [
  ...Object.entries(WORKLOAD_LIMITS).map(([key, value]) => ({ key: `limit.${key}`, value, unit: "count" as Unit, meaning: "Bounded internal executor/ingestion guard; reduce if the host cannot support it" })),
  { key: "histogram.buckets", value: HISTOGRAM_BUCKETS, unit: "count" as Unit, meaning: "Zero bucket and 53 powers-of-two buckets covering safe integer microseconds" },
  ...EMPIRICAL_QUANTILES.map((value) => ({ key: `quantile.${value}`, value, unit: "ratio" as Unit, meaning: "Empirical tail rank; require at least round(1/(1-p)) terminal observations; no confidence-interval claim" })),
  { key: "time.quantum", value: 1, unit: "us" as Unit, meaning: "Integer microsecond scheduling; ceil CPU duration preserves causal nonzero service; never rounds CPU consumption up" },
  ...Object.entries(TRACE_IMPORT_LIMITS).map(([key, value]) => ({ key: `import.${key}`, value, unit: (key === "maxRows" ? "count" : "bytes") as Unit, meaning: "Bounded offline NDJSON import, not an application or infrastructure limit" })),
].map(({ key, value, unit, meaning }) => {
  const id = `m2b.policy.${key}`;
  return { id, concept: key, modelVersion: "2", scope: "Internal M2B workload implementation", validityDomain: "infraforge workload m2b/1; bounded integer-time verification/calibration runs only",
    quantity: { kind: "known", unit, value, provenance: [id] }, formula: meaning, classification: "implementation-policy", confidence: "high",
    provenance: [{ source: "packages/simulation/src/model2/workload/policy.ts", supports: "implementation", detail: meaning }], assumptions: ["No hardware or throughput claim; all public activation remains forbidden"],
    researchedOn: "2026-10-15", freeMode: "forbidden", replacement: "Revisit only using measured executor/observation requirements" };
});
