import type { LearningContent } from "@infraforge/contracts/learning";
import { track as foundations, lessons as foundationsLessons } from "./foundations";
import * as scaling from "./scaling";
import * as data from "./data";

export const tracks = [foundations, scaling.track, data.track];
export const lessons = [...foundationsLessons, ...scaling.lessons, ...data.lessons];
export const learningContent: LearningContent = { tracks, lessons, archivedLessons: [] };
