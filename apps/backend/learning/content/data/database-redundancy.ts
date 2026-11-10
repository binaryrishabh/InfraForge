import type { LearningModule } from "@infraforge/contracts/learning";
import { restoreSafeRedundancy } from "./lessons/restore-safe-redundancy";
export const databaseRedundancyLessons = [restoreSafeRedundancy];
export const databaseRedundancy: LearningModule = {id:"database-redundancy",availability:"available",title:"After service returns",
  summary:"Restore safe redundancy without giving the old primary writer authority.",lessonIds:databaseRedundancyLessons.map(l=>l.id)};
