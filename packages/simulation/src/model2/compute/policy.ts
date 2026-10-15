import type { RealityEntry } from "../../reality/ledger";
export const COMPUTE_LIMITS = { workers: 512, quotaBoundaries: 1000000, interventions: 1024, memoryComponents: 64 } as const;
export const COMPUTE_POLICY_LEDGER: RealityEntry[] = Object.entries(COMPUTE_LIMITS).map(([key, value]) => {
  const id = `m2c.policy.${key}`;
  return { id, concept: key, modelVersion: "2", scope: "Bounded internal compute executor", validityDomain: "m2c/1 verification/calibration only", quantity: { kind: "known", unit: "count", value, provenance: [id] },
    formula: "Internal execution guard; not provider/application capacity", classification: "implementation-policy", confidence: "high",
    provenance: [{ source: "packages/simulation/src/model2/compute/policy.ts", supports: "implementation", detail: "Bound executor cost; no infrastructure performance claim" }],
    assumptions: ["Capped fluid scheduling, integer-us event boundaries, finite authored runs"], researchedOn: "2026-10-15", freeMode: "forbidden", replacement: "Revisit only with measured executor scaling requirements" };
});
COMPUTE_POLICY_LEDGER.push({ ...COMPUTE_POLICY_LEDGER[0]!, id: "m2c.partial-resident", concept: "Incomplete resident model", quantity: { kind: "unknown", unit: "bytes", provenance: ["m2c.partial-resident"], reason: "Declared resident coverage is partial" }, classification: "unknown", confidence: "unknown", formula: "Partial component coverage cannot establish a total" });
COMPUTE_POLICY_LEDGER.push({ ...COMPUTE_POLICY_LEDGER[0]!, id: "m2c.empty-resident", concept: "Explicit complete empty component set", quantity: { kind: "known", unit: "bytes", value: 0, provenance: ["m2c.empty-resident"] }, formula: "Zero only for an explicitly complete empty modeled component set, never a missing input" });
