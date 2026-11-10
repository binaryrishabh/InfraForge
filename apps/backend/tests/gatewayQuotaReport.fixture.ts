import { buildRunReport } from "../reports/report";
import { gatewayQuotaLabFixture } from "./gatewayQuotaLab.fixture";
console.log(JSON.stringify(gatewayQuotaLabFixture().rows.map(r=>buildRunReport(r))));
