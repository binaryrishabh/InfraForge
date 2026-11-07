export { track } from "./track";
import { databasePressureLessons } from "./database-pressure";
import { cacheLifetimeLessons } from "./cache-lifetime";
import { writerFailureLessons } from "./writer-failure";
import { dataTradeoffLessons } from "./data-tradeoffs";
import { objectOwnershipLessons } from "./object-ownership";
export const lessons = [...databasePressureLessons, ...cacheLifetimeLessons, ...writerFailureLessons, ...dataTradeoffLessons, ...objectOwnershipLessons];
