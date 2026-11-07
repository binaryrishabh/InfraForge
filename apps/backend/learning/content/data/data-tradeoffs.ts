import type { LearningModule } from "@infraforge/contracts/learning";
import { chooseDataConstraints } from "./lessons/choose-data-constraints";

export const dataTradeoffLessons = [chooseDataConstraints];
export const dataTradeoffs: LearningModule = {
  id: "data-tradeoffs", availability: "available", title: "Reason across data constraints",
  summary: "Decide which constraints a controlled data-path comparison actually supports.",
  lessonIds: dataTradeoffLessons.map(lesson => lesson.id),
};
