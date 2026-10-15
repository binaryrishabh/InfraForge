import type { RealityEntry } from "../../reality/ledger";
export const DATA_LIMITS = { keys: 100000, keyCharacters: 1024, statements: 32, keysPerStatement: 128, sessions: 512, activeTransactions: 512, interventions: 1024, terminalRows: 1000, expirationScan: 64 } as const;
export const DATA_POLICY_LEDGER: RealityEntry[] = Object.entries(DATA_LIMITS).map(([name, value]) => {
  const id = `m2e.policy.${name}`;
  return { id, concept: name, modelVersion: "2", scope: "Bounded internal keyed relational/cache executor", validityDomain: "m2e/1 only; no provider/performance claim", quantity: { kind: "known", value, unit: "count", provenance: [id] }, classification: "implementation-policy", confidence: "high", formula: "Executor/evidence budget",
    provenance: [{ source: "packages/simulation/src/model2/data/policy.ts", supports: "implementation", detail: "Bound retained logical data and execution" }], assumptions: ["No SQL parser, physical storage engine or Redis allocator emulator"], researchedOn: "2026-10-15", freeMode: "forbidden", replacement: "Review only against measured execution requirements" };
});
