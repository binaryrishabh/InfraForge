import { buildRunReport } from "../reports/report";
import { lbForwardingLabFixture } from "./lbForwardingLab.fixture";
console.log(JSON.stringify(lbForwardingLabFixture().rows.map(r => buildRunReport(r))));
