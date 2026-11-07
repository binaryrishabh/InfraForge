import type { LearningModule } from "@infraforge/contracts/learning";
import { memoryIsNotCpu } from "./lessons/memory-is-not-cpu";
import { fitARequestInMemory } from "./lessons/fit-a-request-in-memory";
import { memoryIsNotCpuV2 } from "./lessons/memory-is-not-cpu-v2";
import { fitARequestInMemoryV2 } from "./lessons/fit-a-request-in-memory-v2";
import { fitARequestInMemoryV3 } from "./lessons/fit-a-request-in-memory-v3";

export const memoryAdmissionLessons = [memoryIsNotCpuV2, fitARequestInMemoryV3];
export const memoryAdmissionArchivedLessons = [memoryIsNotCpu, fitARequestInMemory, fitARequestInMemoryV2];
export const memoryAdmission: LearningModule = {
  id: "memory-admission", title: "Room to admit a request", availability: "available",
  summary: "Distinguish per-VM resident-memory admission from CPU saturation and test a local allocation bound.",
  lessonIds: memoryAdmissionLessons.map(lesson => lesson.id),
};
