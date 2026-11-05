import type { LearningContent } from "@infraforge/contracts/learning";
import { track as foundations, lessons as foundationsLessons } from "./foundations";

export const tracks = [foundations];
export const lessons = [...foundationsLessons];
export const learningContent: LearningContent = { tracks, lessons, archivedLessons: [] };
