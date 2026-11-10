import type { LearningModule } from "@infraforge/contracts/learning";
import { admitAReplicaImage } from "./lessons/admit-a-replica-image";

export const artifactAdmissionLessons = [admitAReplicaImage];
export const artifactAdmission: LearningModule = {
  id: "artifact-admission", availability: "available", title: "Admit the next replica's image",
  summary: "Test a per-client byte limit before counting desired replicas as usable capacity.",
  lessonIds: artifactAdmissionLessons.map(l => l.id),
};
