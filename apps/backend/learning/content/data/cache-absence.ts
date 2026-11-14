import type {LearningModule} from "@infraforge/contracts/learning";
import {cacheAnEmptyAnswerV2 as cacheAnEmptyAnswer} from "./lessons/cache-an-empty-answer-v2";
import {cacheAnEmptyAnswer as originalCacheAnEmptyAnswer} from "./lessons/cache-an-empty-answer";
export const cacheAbsenceArchivedLessons=[originalCacheAnEmptyAnswer];
export const cacheAbsenceLessons=[cacheAnEmptyAnswer];
export const cacheAbsence:LearningModule={id:"cache-absence",availability:"available",title:"Cache a proven absence",summary:"Distinguish a successful empty answer from a failed lookup, and measure the source work that repeated absences create.",lessonIds:cacheAbsenceLessons.map(l=>l.id)};
