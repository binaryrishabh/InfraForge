import type { LearningModule } from "@infraforge/contracts/learning";
import { diagnoseConsumerCredit } from "./lessons/diagnose-consumer-credit";
import { locateTheMissingWait } from "./lessons/locate-the-missing-wait";

export const asyncAndDependenciesLessons = [locateTheMissingWait, diagnoseConsumerCredit];
export const asyncAndDependencies: LearningModule = {
  id: "async-and-dependencies", title: "Find work waiting beyond CPU", availability: "available",
  summary: "Diagnose a slow consumer from saved populations and distinguish dependency-wait hypotheses from measured facts.",
  lessonIds: asyncAndDependenciesLessons.map(lesson => lesson.id),
};
