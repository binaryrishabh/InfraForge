import { contractFromDesign, WORKLOAD_LIMITS, type ProductContract } from "@infraforge/simulation/internal-product";
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
  contract.limits = { ...contract.limits, maxEvents: WORKLOAD_LIMITS.events, maxRequests: WORKLOAD_LIMITS.requests, maxSamples: Math.min(WORKLOAD_LIMITS.samples, horizonSeconds + 1) };
  return contract;
}
