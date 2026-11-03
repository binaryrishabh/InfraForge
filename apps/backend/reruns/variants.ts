import type { RerunOptions, WorkloadVariant } from "@infraforge/contracts/reports";
import type { RunInputs } from "@infraforge/contracts/run-inputs";
import { applyWorkloadVariant, describeWorkloadVariantSource, workloadDynamicsError, clientRetryError, workloadObjectiveError } from "@infraforge/domain/workload";
import { readRunInputs, assertSimulationContext } from "../deployments/runInputs";
import type { StoredRun } from "../reports/report";
import { compareInputs } from "../comparison/inputs";
import { canonical } from "../comparison/design";

const variants: WorkloadVariant[] = [
  {dimension: "arrival-process", value: "even"}, {dimension: "arrival-process", value: "poisson"},
  {dimension: "application-cpu-variability", value: "fixed"}, {dimension: "application-cpu-variability", value: "moderate"},
  {dimension: "application-cpu-variability", value: "high"},
];

// Copy captured inputs; recapturing a design would select new adapter profiles.
export function createWorkloadVariantInput(value: unknown, variant: WorkloadVariant): RunInputs {
  const source = readRunInputs(value);
  if (canonical(source) !== canonical(value)) throw new Error("Captured input contains unsupported fields. A variant cannot silently discard them.");
  assertSimulationContext(source);
  const workloadProfile = applyWorkloadVariant(source.workloadProfile, variant);
  if (canonical(workloadProfile) === canonical(source.workloadProfile)) throw new Error("Already the source setting.");
  for (const error of [workloadDynamicsError(workloadProfile.workloadDynamics), clientRetryError(workloadProfile.clientRetry), workloadObjectiveError(workloadProfile.workloadObjective)]) {
    if (error) throw new Error(error);
  }
  const candidate = {...source, workloadProfile};
  const validated = readRunInputs(candidate);
  if (canonical(validated) !== canonical(candidate) || compareInputs(source, validated).grade !== "one-change-workload") {
    throw new Error("The candidate must have exactly one recorded workload change with every other captured input unchanged.");
  }
  return candidate;
}

export function buildWorkloadVariantOptions(source: StoredRun, input: RunInputs | null, exactReason: string | null,
  hash: (input: RunInputs) => string): RerunOptions["workloadVariant"] {
  const reason = exactReason ?? (source.challengeId != null || source.challengeVersion != null || source.challengeScenario != null ?
    "Workload variants require a freeform source without a challenge or scenario." : null);
  if (reason || !input) return {available: false, reason: reason ?? "Readable captured V2 input is required.", source: null, choices: []};
  try {
    const settings = describeWorkloadVariantSource(input.workloadProfile);
    const choices = variants.map(variant => {
      try {
        const candidate = createWorkloadVariantInput(input, variant);
        return {variant, available: true, reason: null, preview: compareInputs(input, candidate), inputHash: hash(candidate)};
      } catch (error) {
        return {variant, available: false, reason: error instanceof Error ? error.message : "Workload variant unavailable.", preview: null, inputHash: null};
      }
    });
    const available = choices.some(choice => choice.available);
    return {available, reason: available ? null : "No supported workload alternative is available.", source: settings, choices};
  } catch (error) {
    return {available: false, reason: error instanceof Error ? error.message : "Captured workload dynamics are invalid.", source: null, choices: []};
  }
}
