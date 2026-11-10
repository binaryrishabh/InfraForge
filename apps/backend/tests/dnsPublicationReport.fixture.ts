import { buildRunReport } from "../reports/report";
import { dnsPublicationLabFixture } from "./dnsPublicationLab.fixture";
console.log(JSON.stringify(dnsPublicationLabFixture().rows.map(r => buildRunReport(r))));
