import type { LearningContent } from "@infraforge/contracts/learning";
import { track as foundations, lessons as foundationsLessons } from "./foundations";
import * as scaling from "./scaling";
import * as data from "./data";
import * as asynchronous from "./async";
import * as failures from "./failures";
import * as missions from "./missions";
import * as depth from "./depth";
import * as advanced from "./advanced";
import * as architecture from "./architecture";

export const tracks = [foundations, scaling.track, data.track, asynchronous.track, failures.track, missions.track, depth.track, advanced.track, architecture.track];
export const lessons = [...foundationsLessons, ...scaling.lessons, ...data.lessons, ...asynchronous.lessons, ...failures.lessons, ...missions.lessons, ...depth.lessons, ...advanced.lessons, ...architecture.lessons];
export const learningContent: LearningContent = { tracks, lessons, archivedLessons: [] };
