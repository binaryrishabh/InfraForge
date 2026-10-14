import { PREDICTION_CHOICES, type PredictionQuestion } from "@infraforge/contracts/challenges";

// Fixed answer sets, or the resource types present in the design for "busiest type".
export function predictionChoices(question: PredictionQuestion, designTypes: string[]) {
  return question.kind === "busiest-type" ? designTypes.map((t) => ({ value: t, label: t })) : PREDICTION_CHOICES[question.kind];
}
