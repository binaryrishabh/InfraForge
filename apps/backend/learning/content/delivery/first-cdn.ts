import type { LearningModule } from "@infraforge/contracts/learning";
import { keepAnAssetCachedV2 as keepAnAssetCached } from "./lessons/keep-an-asset-cached-v2";

export const lessons = [keepAnAssetCached];
export const firstCdn: LearningModule = {id: "first-cdn", title: "A first CDN run", availability: "available",
  summary: "Distinguish a cached asset's lifetime from its origin's availability.", lessonIds: lessons.map(l => l.id)};
