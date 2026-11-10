import type { LearningModule } from "@infraforge/contracts/learning";
import { resolveAfterPublication } from "./lessons/resolve-after-publication";
export const dnsPublicationLessons = [resolveAfterPublication];
export const dnsPublication: LearningModule = {id: "dns-publication", title: "After the name appears", availability: "available",
  summary: "Compare authority publication with cached negative answers and caller outcomes.", lessonIds: dnsPublicationLessons.map(l => l.id)};
