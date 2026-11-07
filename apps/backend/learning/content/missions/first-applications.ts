import type { LearningModule } from "@infraforge/contracts/learning";
import { catalogueLinkFlashV2 as catalogueLinkFlash } from "./lessons/catalogue-link-flash-v2";
import { flashSaleOrderBacklog } from "./lessons/flash-sale-order-backlog";

export const firstApplicationLessons = [catalogueLinkFlash, flashSaleOrderBacklog];
export const firstApplications: LearningModule & {availability: "available"} = {
  id: "first-applications", title: "Combine earlier lessons", availability: "available",
  summary: "Test a catalogue flash and a shop's background order-event backlog using fixed educational assumptions.",
  lessonIds: firstApplicationLessons.map(lesson => lesson.id),
};
