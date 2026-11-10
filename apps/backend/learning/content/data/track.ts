import { databaseRedundancy } from "./database-redundancy";
import { objectCapacity } from "./object-capacity";
import { databaseIncident } from "./database-incident";
import type { LearningTrack } from "@infraforge/contracts/learning";
import { databasePressure } from "./database-pressure";
import { cacheWorkingSet } from "./cache-working-set";
import { cacheLifetime } from "./cache-lifetime";
import { writerFailure } from "./writer-failure";
import { dataTradeoffs } from "./data-tradeoffs";
import { objectOwnership } from "./object-ownership";

export const track: LearningTrack = {
  id: "data", availability: "available", title: "Databases and caching",
  summary: "Follow read and write execution, budget database sessions and inspect delayed replica reads.", modules: [databasePressure, cacheLifetime, writerFailure, dataTradeoffs, objectOwnership, databaseIncident, objectCapacity, databaseRedundancy, cacheWorkingSet],
};
