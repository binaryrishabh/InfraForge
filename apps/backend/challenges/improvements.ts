import { canonical } from "../comparison/design";
import { assertSimulationContext, captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { ConflictError } from "../utils/errors";
import { findChallenge, challengeSeed } from "./registry";
import { recordedExperiment } from "./experiment";
import { readPrediction } from "./prediction";

// Never substitute the latest version, current saved design, seed or rules.
export function improvementSource(row: { challengeId?: string | null; challengeVersion?: number | null; challengeSpecHash?: string | null;
  status: string; runtimeActive?: boolean; runInputs: unknown; challengePrediction?: unknown;
  evaluationStopAtSimulatedSeconds?: number | null; challengeExperiment?: unknown }, challengeId: string) {
  const entry = row.challengeId === challengeId && row.challengeVersion ? findChallenge(challengeId, row.challengeVersion) : null;
  if (!entry || entry.hash !== row.challengeSpecHash || row.runtimeActive || !["completed", "failed", "torn-down"].includes(row.status)) {
    throw new ConflictError("The source must be a finished attempt with its exact challenge version available.");
  }
  let input;
  try { input = readRunInputs(row.runInputs); assertSimulationContext(input); }
  catch { throw new ConflictError("The source's captured inputs cannot be reused safely."); }
  const { definition } = entry;
  if (definition.engine !== "2") throw new ConflictError("This attempt ran on the retired Model 1. Its report stays readable, but it cannot be improved; start the challenge's current version instead.");

  try { readPrediction(row.challengePrediction, definition, input.resources.map((r) => r.type)); }
  catch { throw new ConflictError("The source has no readable complete prediction; its challenge conditions cannot be reused safely."); }
  const fixed = captureRunInputs(input, definition.workload, challengeSeed(definition), definition.engine);
  if (input.version !== 2 || input.simulationModelVersion !== fixed.simulationModelVersion || canonical(input) !== canonical(row.runInputs) ||
      canonical(input.workloadProfile) !== canonical(fixed.workloadProfile) || input.seed !== fixed.seed ||
      row.evaluationStopAtSimulatedSeconds !== definition.evaluationSeconds ||
      canonical(row.challengeExperiment ?? null) !== canonical(recordedExperiment(definition))) {
    throw new ConflictError("The source's recorded conditions do not match its challenge version. No conditions were substituted.");
  }
  return { ...entry, input };
}
