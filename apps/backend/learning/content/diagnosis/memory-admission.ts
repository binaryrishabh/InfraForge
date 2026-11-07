import type { LearningModule } from "@infraforge/contracts/learning";
import { memoryIsNotCpu } from "./lessons/memory-is-not-cpu";
import { fitARequestInMemory } from "./lessons/fit-a-request-in-memory";

export const memoryAdmissionLessons = [memoryIsNotCpu, fitARequestInMemory];
export const memoryAdmission: LearningModule = {
  id: "memory-admission", title: "Room to admit a request", availability: "available",
  summary: "Distinguish per-VM resident-memory admission from CPU saturation and test a local allocation bound.",
  lessonIds: memoryAdmissionLessons.map(lesson => lesson.id),
};
