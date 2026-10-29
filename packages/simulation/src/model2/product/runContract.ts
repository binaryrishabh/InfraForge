import type { AdapterProfile, RunProfileSelection, RunTopology } from "@infraforge/contracts/run-inputs";
import type { ResolvedWorkloadProfile } from "@infraforge/domain/workload";
import { contractFromDesign } from "./fromDesign";
import { WORKLOAD_LIMITS } from "../workload/policy";
import type { Quantity } from "../../reality/quantity";
import type { ProductContract, SavedProductDesign } from "./contracts";

export type ContractBuilder = (design: SavedProductDesign, horizonSeconds: number, seed: string, adapterProfiles?: readonly AdapterProfile[]) => { contract: ProductContract } | { refused: string[] };

// A run's design as a Model 2 contract: the adapter's listed assumptions, with the run's own length and seed.
// Limits are the engine's ceilings; a run that reaches one ends there and says so.
export const buildModel2Contract: ContractBuilder = (design, horizonSeconds, seed, adapterProfiles = []) => {
  const result = contractFromDesign(design, { adapterProfiles });
  if ("refused" in result) return { refused: result.refused.map((d) => d.message) };
  return { contract: withRunLength(result.contract, horizonSeconds, seed) };
};

export type CapturedModel2Input = RunTopology & RunProfileSelection & { workloadProfile: ResolvedWorkloadProfile; seed: string };

// Every replay, worker and action rebuild starts with the captured selection; absence means no implicit profiles.
export function buildContractFromRunInputs(input: CapturedModel2Input, horizonSeconds: number, build: ContractBuilder = buildModel2Contract) {
  const design: SavedProductDesign = { schema: "infraforge-saved-design/1", resources: input.resources, connections: input.connectionLines, workload: input.workloadProfile };
  return build(design, horizonSeconds, input.seed, input.adapterProfiles ?? []);
}

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
  contract.limits = { ...contract.limits, maxEvents: base.applicationFlowProfile ? base.limits.maxEvents : WORKLOAD_LIMITS.events, maxRequests: base.applicationFlowProfile ? base.limits.maxRequests : WORKLOAD_LIMITS.requests, maxSamples: Math.min(WORKLOAD_LIMITS.samples, horizonSeconds + 1) };
  return contract;
}

function assumed(contract: ProductContract, id: string, value: number): Quantity<"us"> {
  const sentence = `Peak traffic: ${id.replace("run.burst.", "burst ")} at ${value / 1_000_000} s.`;
  contract.ledger = contract.ledger.filter((e) => e.id !== id);
  contract.ledger.push({ id, concept: id, modelVersion: "2", scope: "Live run traffic pattern", validityDomain: "Live run traffic pattern",
    quantity: { kind: "known", value, unit: "us", provenance: [id] }, formula: String(value), classification: "educational-assumption", confidence: "conditional",
    provenance: [{ source: "packages/simulation/src/model2/product/runContract.ts", supports: "implementation", detail: sentence }], assumptions: [sentence],
    researchedOn: "2026-10-28", freeMode: "forbidden", replacement: "A recorded or chosen traffic pattern" });
  return { kind: "known", value, unit: "us", provenance: [id] };
}
