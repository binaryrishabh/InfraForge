import type { LearningContent } from "@infraforge/contracts/learning";
import { track as foundations, lessons as foundationsLessons } from "./foundations";
import * as scaling from "./scaling";

export const tracks = [foundations, scaling.track];
export const lessons = [...foundationsLessons, ...scaling.lessons];
export const learningContent: LearningContent = { tracks, lessons, archivedLessons: [] };
