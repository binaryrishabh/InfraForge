import { createHash } from "node:crypto";
import type { RerunOptions } from "@infraforge/contracts/reports";
import type { RunInputs } from "@infraforge/contracts/run-inputs";
import { captureRunInputs, readRunInputs, assertSimulationContext, runsOnModel2 } from "../deployments/runInputs";
import { summarizeRun, type StoredRun } from "../reports/report";
import { readRecords } from "../reports/records";
import { compareInputs } from "../comparison/inputs";
import { canonical } from "../comparison/design";
import { historicalExecutionPolicy, type HistoricalExecutionPolicy } from "../runRecords/availability";

export const MAX_MATCHED_STOP_SECONDS = 604800;
export function rerunInputHash(input: RunInputs) { return createHash("sha256").update(canonical(input)).digest("hex"); }
export function currentDesignInput(source: RunInputs, layout: unknown) {
  // A rerun keeps the engine of the run it repeats.
  return { ...captureRunInputs(layout, source.workloadProfile, undefined, runsOnModel2(source) ? "2" : "1"), seed: source.seed };
}
export function buildRerunOptions(source: StoredRun & { runtimeActive?: boolean }, layout: unknown | null, policy: HistoricalExecutionPolicy = historicalExecutionPolicy): RerunOptions {
  let input: RunInputs | null = null;
  try { input = readRunInputs(source.runInputs); } catch { /* Never reconstruct a missing input. */ }
  const inactive = ["completed", "failed", "torn-down"].includes(source.status) && !source.runtimeActive;
  const retiredReason = policy.model1Retired ? "Execution retired: historical Model 1 execution is unavailable. Migrate a reviewed design into a new Model 2 run." : null;
  let exactReason: string | null = retiredReason ?? (!inactive ? "Wait for this run to finish or stop it first." : input?.version !== 2 ? "Exact rerun requires readable captured V2 input; legacy provenance cannot be invented." : null);
  if (!exactReason && canonical(input) !== canonical(source.runInputs)) exactReason = "Captured input contains unsupported fields. Exact rerun cannot silently discard them.";
  if (!exactReason && input) try { assertSimulationContext(input); } catch { exactReason = "Captured model/catalog differs from the current runtime. Exact rerun is unavailable."; }
  let currentReason: string | null = retiredReason ?? (!inactive ? "Wait for this run to finish or stop it first." : !input ? "Readable captured workload and seed are required." : layout === null ? "The original saved design was deleted or is unavailable." : null);
  let current: ReturnType<typeof currentDesignInput> | null = null;
  if (!currentReason && input) try { current = currentDesignInput(input, layout); } catch { currentReason = "The saved design is invalid. Update it before rerunning."; }
  const final = readRecords(source, []).terminal;
  const seconds = final?.simulatedSeconds;
  const target = !policy.model1Retired && inactive && seconds !== undefined && Number.isSafeInteger(seconds) && seconds > 0 && seconds <= MAX_MATCHED_STOP_SECONDS ? seconds : null;
  const preview = current ? compareInputs(input, current) : null;
  return { source: summarizeRun(source), workload: input?.workloadProfile ?? null, seed: input?.seed ?? null,
    exact: { available: exactReason === null, reason: exactReason },
    currentDesign: { available: currentReason === null, reason: currentReason, preview, inputHash: current ? rerunInputHash(current) : null,
      modelCatalogCompatible: preview?.facets.model === "same" && preview.facets.catalog === "same" },
    matchedStop: { available: target !== null, target, defaultEnabled: target !== null,
      reason: target === null ? "Matched stop requires a valid exact source terminal duration from 1 to 604,800 simulated seconds; checkpoints do not qualify." : null } };
}
