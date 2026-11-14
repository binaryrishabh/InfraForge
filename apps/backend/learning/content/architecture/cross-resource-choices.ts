import type { LearningModule } from "@infraforge/contracts/learning";
import { cacheOrDatabaseV3 as cacheOrDatabase } from "./lessons/cache-or-database-v3";
import { oneVmOrAPool } from "./lessons/one-vm-or-a-pool";
import { limitOrCapacityV2 as limitOrCapacity } from "./lessons/limit-or-capacity-v2";

export const crossResourceChoicesLessons = [cacheOrDatabase, oneVmOrAPool, limitOrCapacity];
export const crossResourceChoices: LearningModule = {
  id: "cross-resource-choices", title: "Choose under requirements", availability: "available",
  summary: "Combine earlier ideas and defend different passing designs using real engine evidence and explicit limits.",
  lessonIds: crossResourceChoicesLessons.map(l => l.id),
};
