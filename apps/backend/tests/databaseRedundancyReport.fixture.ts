import { buildRunReport } from "../reports/report";
import { redundancyFixture } from "./databaseRedundancy.fixture";
console.log(JSON.stringify(redundancyFixture().rows.map(r => buildRunReport(r))));
