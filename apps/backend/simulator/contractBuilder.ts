import { contractFromDesign, WORKLOAD_LIMITS, type ProductContract, type Quantity } from "@infraforge/simulation/internal-product";
import type { ContractBuilder } from "./model2Engine";

// A run's design as a Model 2 contract: the adapter's listed assumptions, with the run's own length and seed.
// Limits are the engine's ceilings; a run that reaches one ends there and says so.
export const buildModel2Contract: ContractBuilder = (design, horizonSeconds, seed) => {
  const result = contractFromDesign(design);
  if ("refused" in result) return { refused: result.refused.map((d) => d.message) };
  return { contract: withRunLength(result.contract, horizonSeconds, seed) };
};

export function withRunLength(base: ProductContract, horizonSeconds: number, seed: string): ProductContract {
  const contract = JSON.parse(JSON.stringify(base)) as ProductContract, horizonUs = horizonSeconds * 1_000_000;
  const id = contract.horizon.provenance[0], entry = contract.ledger.find((e) => e.id === id);
  if (!entry || entry.quantity.kind !== "known" || contract.horizon.kind !== "known") throw new Error("The design contract has no known run length");
  // The run length is the person's choice (or the challenge's), not an assumption.
  Object.assign(entry, { quantity: { ...entry.quantity, value: horizonUs }, formula: String(horizonUs), classification: "user-input",
    assumptions: [`The run lasts ${horizonSeconds} simulated seconds.`] });
  contract.horizon = { ...contract.horizon, value: horizonUs };
  contract.seed = seed;
  // "Peak" traffic is a 20-second burst every 120 seconds, starting at second 120, as in the guided challenges.
  if (contract.arrival.peak) contract.arrival.peak = { start: assumed(contract, "run.burst.start", 120_000_000), end: assumed(contract, "run.burst.end", 140_000_000),
    every: assumed(contract, "run.burst.every", 120_000_000) };
  contract.limits = { ...contract.limits, maxEvents: WORKLOAD_LIMITS.events, maxRequests: WORKLOAD_LIMITS.requests, maxSamples: Math.min(WORKLOAD_LIMITS.samples, horizonSeconds + 1) };
  return contract;
}

function assumed(contract: ProductContract, id: string, value: number): Quantity<"us"> {
  const sentence = `Peak traffic: ${id.replace("run.burst.", "burst ")} at ${value / 1_000_000} s.`;
  contract.ledger = contract.ledger.filter((e) => e.id !== id);
  contract.ledger.push({ id, concept: id, modelVersion: "2", scope: "Live run traffic pattern", validityDomain: "Live run traffic pattern",
    quantity: { kind: "known", value, unit: "us", provenance: [id] }, formula: String(value), classification: "educational-assumption", confidence: "conditional",
    provenance: [{ source: "apps/backend/simulator/contractBuilder.ts", supports: "implementation", detail: sentence }], assumptions: [sentence],
    researchedOn: "2026-10-28", freeMode: "allowed", replacement: "A recorded or chosen traffic pattern" });
  return { kind: "known", value, unit: "us", provenance: [id] };
}
