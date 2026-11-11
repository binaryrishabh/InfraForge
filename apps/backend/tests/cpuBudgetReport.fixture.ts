import { buildRunReport } from "../reports/report";
import { cpuBudgetLabFixture } from "./cpuBudgetLab.fixture";
console.log(JSON.stringify(cpuBudgetLabFixture().rows.map(r => buildRunReport(r))));
