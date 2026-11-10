import type { LearningModule } from "@infraforge/contracts/learning";
import { objectBytesVersusAppCpu } from "./lessons/object-bytes-versus-app-cpu";

export const objectCapacityLessons = [objectBytesVersusAppCpu];
export const objectCapacity: LearningModule = {
  id: "object-capacity", title: "Object byte admission", availability: "available",
  summary: "Test a store's owned-byte bound while producer CPU has spare capacity.",
  lessonIds: objectCapacityLessons.map(lesson => lesson.id),
};
