import { z } from "zod";
import { PREDICTION_CHOICES, PREDICTION_REASONING_MAX, type ChallengeDefinition, type ChallengePrediction } from "@infraforge/contracts/challenges";
import { RESOURCE_TYPES } from "@infraforge/domain/resource";
import { ValidationError } from "../utils/errors";

const body = z.object({
  answers: z.record(z.string().min(1).max(64), z.string().min(1).max(64)),
  reasoning: z.string().max(PREDICTION_REASONING_MAX * 2).nullable().optional(),
}).strict();

export function choicesFor(kind: ChallengeDefinition["predictions"][number]["kind"], designTypes: string[]) {
  return kind === "busiest-type" ? [...new Set(designTypes)] : PREDICTION_CHOICES[kind].map((choice) => choice.value);
}

/* Every question must be answered before the attempt exists. The answer set is
closed: fixed choices, or a resource type present in the submitted design. */
export function readPrediction(input: unknown, definition: ChallengeDefinition, designTypes: string[]): ChallengePrediction {
  const parsed = body.safeParse(input);
  if (!parsed.success) throw new ValidationError("Answer every prediction before starting the attempt.");
  const { answers } = parsed.data;
  const expected = definition.predictions.map((question) => question.id);
  if (Object.keys(answers).length !== expected.length || expected.some((id) => !Object.hasOwn(answers, id))) {
    throw new ValidationError("Answer every prediction before starting the attempt.");
  }
  for (const question of definition.predictions) {
    const answer = answers[question.id]!;
    const valid = choicesFor(question.kind, designTypes).includes(answer) &&
      (question.kind !== "busiest-type" || Object.values(RESOURCE_TYPES).includes(answer as never));
    if (!valid) throw new ValidationError(`"${question.prompt}" needs one of the offered answers.`);
  }
  const reasoning = parsed.data.reasoning?.trim() ?? "";
  if (reasoning.length > PREDICTION_REASONING_MAX) throw new ValidationError(`Keep your reasoning under ${PREDICTION_REASONING_MAX} characters.`);
  return { answers: Object.fromEntries(expected.map((id) => [id, answers[id]!])), reasoning: reasoning || null };
}

const stored = z.object({ answers: z.record(z.string(), z.string()), reasoning: z.string().nullable() }).strict();
export function readStoredPrediction(value: unknown): ChallengePrediction | null {
  const parsed = stored.safeParse(value);
  return parsed.success ? parsed.data : null;
}
