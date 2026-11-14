import type {LearningModule} from "@infraforge/contracts/learning";
import {cacheAnEmptyAnswer} from "./lessons/cache-an-empty-answer";
export const cacheAbsenceLessons=[cacheAnEmptyAnswer];
export const cacheAbsence:LearningModule={id:"cache-absence",availability:"available",title:"Cache a proven absence",summary:"Distinguish a successful empty answer from a failed lookup, and measure the source work that repeated absences create.",lessonIds:cacheAbsenceLessons.map(l=>l.id)};
