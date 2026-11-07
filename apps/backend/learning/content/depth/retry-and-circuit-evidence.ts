import type { LearningModule } from "@infraforge/contracts/learning";
import { testACircuitAgain } from "./lessons/test-a-circuit-again";

export const retryAndCircuitEvidenceLessons = [testACircuitAgain];
export const retryAndCircuitEvidence: LearningModule = {
  id: "retry-and-circuit-evidence", title: "Read the caller's admission policy", availability: "available",
  summary: "Explain a circuit cooldown using retained path diagnostics and scored caller outcomes.",
  lessonIds: retryAndCircuitEvidenceLessons.map(l => l.id),
};
