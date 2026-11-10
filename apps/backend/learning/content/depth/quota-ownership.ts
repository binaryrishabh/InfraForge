import type { LearningModule } from "@infraforge/contracts/learning";
import { isolateRouteCredits } from "./lessons/isolate-route-credits";
export const quotaOwnershipLessons = [isolateRouteCredits];
export const quotaOwnership: LearningModule = {id: "quota-ownership", title: "Who owns the credits?", availability: "available",
  summary: "Separate policy coupling from gateway CPU pressure using saved route outcomes.", lessonIds: quotaOwnershipLessons.map(l => l.id)};
