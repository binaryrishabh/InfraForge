import { buildRunReport } from "../reports/report";
import { functionReuseLabFixture } from "./functionReuseLab.fixture";
console.log(JSON.stringify(functionReuseLabFixture().rows.map(r => buildRunReport(r))));
