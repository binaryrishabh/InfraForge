import type { LearningModule } from "@infraforge/contracts/learning";
import { serveStaleOnError } from "./lessons/serve-stale-on-error";
export const boundedStalenessLessons = [serveStaleOnError];
export const boundedStaleness: LearningModule = {id: "bounded-staleness", availability: "available", title: "Trade freshness for availability",
  summary: "Answer from an expired entry for a bounded time while a dependency is down.", lessonIds: boundedStalenessLessons.map(l => l.id)};
