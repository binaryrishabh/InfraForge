import type { RunInputs } from "@infraforge/contracts/run-inputs";
import { validateModel2Readiness } from "@infraforge/simulation/internal-product";

// Admission and the worker validate the exact captured selection, including absent historical profiles.
export function runValidation(input: RunInputs) {
  return validateModel2Readiness(input.resources, input.connectionLines, { workload: input.workloadProfile, adapterProfiles: input.adapterProfiles ?? [] });
}
