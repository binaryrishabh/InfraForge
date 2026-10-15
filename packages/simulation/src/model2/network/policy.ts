import type { RealityEntry } from "../../reality/ledger";
export const NETWORK_LIMITS = { links: 512, paths: 512, hops: 16, connectionsPerPool: 512, streamsPerConnection: 256, pendingPerPool: 100000, interventions: 1024, attempts: 8, healthChecks: 100000, identityCharacters: 1024 } as const;
export const NETWORK_POLICY_LEDGER: RealityEntry[] = Object.entries(NETWORK_LIMITS).map(([name, value]) => {
  const id = `m2d.policy.${name}`;
  return { id, concept: name, modelVersion: "2", scope: "Bounded internal message/link/connection executor", validityDomain: "m2d/1 only; no physical or provider claim",
    quantity: { kind: "known", unit: "count", value, provenance: [id] }, formula: "Authored implementation guard", classification: "implementation-policy", confidence: "high",
    provenance: [{ source: "packages/simulation/src/model2/network/policy.ts", supports: "implementation", detail: "Bound execution/evidence cost" }], assumptions: ["Whole-message FIFO store-and-forward; no packets/TCP congestion/retransmissions"], researchedOn: "2026-10-15", freeMode: "forbidden", replacement: "Review with executor measurements" };
});
