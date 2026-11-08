import { restoreADatabaseWriterV1 as d } from "../challenges/definitions/restore-a-database-writer/v1";
import { buildRunReport } from "../reports/report";
import { REFERENCE, answers, attemptRow } from "./challengeHarness";
const designs = [d.starter!, REFERENCE[d.id]!, structuredClone(REFERENCE[d.id]!)];
designs[2]!.resources[1]!.databaseReplication!.replicationDelayMs = 60000;
console.log(JSON.stringify(designs.map(design => buildRunReport(attemptRow(d, design, answers(d, {"overall-health": "healthy"}))))));
