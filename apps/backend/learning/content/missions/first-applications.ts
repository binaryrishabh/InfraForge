import type { ModuleDefinition } from "@infraforge/contracts/learning";
import { catalogueLinkFlash } from "./lessons/catalogue-link-flash";
import { flashSaleOrderBacklog } from "./lessons/flash-sale-order-backlog";

export const firstApplicationLessons = [catalogueLinkFlash, flashSaleOrderBacklog];
export const firstApplications: ModuleDefinition & {availability: "available"} = {
  id: "first-applications", title: "Combine earlier lessons", availability: "available",
  summary: "Test a catalogue flash and a shop's background order-event backlog using fixed educational assumptions.",
  lessonIds: firstApplicationLessons.map(lesson => lesson.id),
};
