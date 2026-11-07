import type { LearningModule } from "@infraforge/contracts/learning";
import { diagnoseConsumerCredit } from "./lessons/diagnose-consumer-credit";
import { diagnoseConsumerCreditV2 } from "./lessons/diagnose-consumer-credit-v2";
import { diagnoseConsumerCreditV3 } from "./lessons/diagnose-consumer-credit-v3";
import { locateTheMissingWaitV2 } from "./lessons/locate-the-missing-wait-v2";
import { locateTheMissingWait } from "./lessons/locate-the-missing-wait";

export const asyncAndDependenciesLessons = [locateTheMissingWaitV2, diagnoseConsumerCreditV3];
export const asyncAndDependenciesArchivedLessons = [diagnoseConsumerCredit, diagnoseConsumerCreditV2, locateTheMissingWait];
export const asyncAndDependencies: LearningModule = {
  id: "async-and-dependencies", title: "Find work waiting beyond CPU", availability: "available",
  summary: "Diagnose a slow consumer from saved populations and distinguish dependency-wait hypotheses from measured facts.",
  lessonIds: asyncAndDependenciesLessons.map(lesson => lesson.id),
};
