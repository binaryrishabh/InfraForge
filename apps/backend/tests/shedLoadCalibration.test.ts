import { test } from "bun:test";
import { buildRunReport } from "../reports/report";
import { shedLoadLabFixture } from "./shedLoadLab.fixture";
test("probe", () => {
  for (const row of shedLoadLabFixture().rows) {
    const r = buildRunReport(row);
    console.info("PROBE", JSON.stringify({st: r.challenge!.status, crit: r.challenge!.criteria.map(c => [c.id, c.status, c.detail]), health: r.challenge!.predictions[0]!.actual, cpu: r.terminal!.resources.map(x => [x.id, x.cpu])}));
  }
}, 200000);
