import type { LearningModule } from "@infraforge/contracts/learning";
import { shedLoadAtTheEdge } from "./lessons/shed-load-at-the-edge";
import { setTheLimitAboveThePeak } from "./lessons/set-the-limit-above-the-peak";

export const edgeAdmissionLessons = [shedLoadAtTheEdge, setTheLimitAboveThePeak];
export const edgeAdmission: LearningModule = {
  id: "edge-admission", availability: "available", title: "Admit less to protect the tail",
  summary: "Decide what the balancer lets through when demand exceeds capacity.",
  lessonIds: edgeAdmissionLessons.map(l => l.id),
};
