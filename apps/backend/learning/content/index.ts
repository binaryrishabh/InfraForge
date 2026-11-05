import type { LearningContent } from "@infraforge/contracts/learning";
import { track as foundations, lessons as foundationsLessons } from "./foundations";
import * as scaling from "./scaling";
import * as data from "./data";
import * as asynchronous from "./async";
import * as failures from "./failures";

export const tracks = [foundations, scaling.track, data.track, asynchronous.track, failures.track];
export const lessons = [...foundationsLessons, ...scaling.lessons, ...data.lessons, ...asynchronous.lessons, ...failures.lessons];
export const learningContent: LearningContent = { tracks, lessons, archivedLessons: [] };
