import { databaseRedundancyLessons } from "./database-redundancy";
import { objectCapacityLessons } from "./object-capacity";
import { databaseIncidentLessons } from "./database-incident";
export { track } from "./track";
import { databasePressureLessons } from "./database-pressure";
import { cacheLifetimeLessons } from "./cache-lifetime";
import { writerFailureLessons } from "./writer-failure";
import { dataTradeoffLessons } from "./data-tradeoffs";
import { objectOwnershipLessons } from "./object-ownership";
export const lessons = [...databasePressureLessons, ...cacheLifetimeLessons, ...writerFailureLessons, ...dataTradeoffLessons, ...objectOwnershipLessons, ...databaseIncidentLessons, ...objectCapacityLessons, ...databaseRedundancyLessons];

import { cacheEvidenceArchivedLessons } from "./cache-evidence-archives";
import { connectionPoolBudgets } from "./lessons/connection-pool-budgets";
import { promotingAReplica } from "./lessons/promoting-a-replica";
export const archivedLessons = [...cacheEvidenceArchivedLessons, connectionPoolBudgets, promotingAReplica];
