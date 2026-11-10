import type { LearningModule } from "@infraforge/contracts/learning";
import { shareOneOriginFetch } from "./lessons/share-one-origin-fetch";
export const originLoadLessons = [shareOneOriginFetch];
export const originLoad: LearningModule = {id: "origin-load", title: "Protect the origin", availability: "available",
  summary: "Share refills of an expired object so the origin sees one fetch.", lessonIds: originLoadLessons.map(l => l.id)};
