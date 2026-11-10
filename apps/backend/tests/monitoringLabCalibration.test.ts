import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { reviewDesignChanges } from "../challenges/designChanges";
import { preflight } from "../challenges/preflight";
import { challengeSeed, specHash } from "../challenges/registry";
import { buildRunReport } from "../reports/report";
import { labPolicy, monitoringLabFixture } from "./monitoringLab.fixture";

test("move-monitoring-samples: batch throughput alone fixes delivery; more buffer is a failing near miss", () => {
  const {d, designs, rows} = monitoringLabFixture(), reports = rows.map(r => buildRunReport(r));
  expect(validateInfrastructureName(d.title)).toBeNull();
  const pins = readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8");
  expect(specHash(d)).toBe(/"move-monitoring-samples@1": "([a-f0-9]{64})"/.exec(pins)![1]!);
  for (const design of designs) expect(preflight(d, design).errors).toEqual([]);
  const inputs = designs.map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
  for (const [i, field, earlier, later] of [[1,"batchSamples",1,16], [2,"bufferSamples",64,256]] as const) {
    expect(reviewDesignChanges(inputs[0]!, inputs[i]!)).toMatchObject({classification: "one-change", count: 1,
      differences: {reconfigured: [{id:"monitor",fields:[{field:"monitoringPolicy",earlier:expect.anything(),later:expect.anything()}]}]}});
    const restored = structuredClone(designs[i]!); labPolicy(restored)[field] = earlier;
    expect(restored).toEqual(designs[0]!);
    expect(labPolicy(designs[i]!)[field]).toBe(later);
  }
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met","met","not-met"]);
  const metrics = reports.map(r => {
    const t=r.terminal!, m=t.resources.find(r => r.id === "monitor")!;
    return {generated:m.monitoring!.generated, exported:m.monitoring!.exported, dropped:m.monitoring!.droppedBeforeExport,
      buffered:m.monitoring!.bufferedSamples, received:m.monitoringBackend!.received, duplicates:m.monitoringBackend!.duplicates,
      latest:m.monitoringBackend!.latest, collector:m.monitoring!.freshness, callers:t.traffic!.wholeRun};
  });
  expect(metrics.map(m => [m.generated,m.exported,m.received,m.dropped,m.buffered,m.duplicates])).toEqual([[178,17,17,97,64,0],[178,168,168,0,10,0],[178,17,17,0,161,0]]);
  expect(metrics[0]!.latest!.map(r => r.ageUs)).toEqual([80_999_691,81_999_691]);
  expect(metrics[1]!.latest!.every(r => r.ageUs! < 7_000_000)).toBe(true);
  expect(metrics[2]!.latest).toEqual(metrics[0]!.latest);
  for (const [i,input] of inputs.entries()) {
    // Independent default-compiler replay must reproduce harness capture and saved JSON.
    const engine=createModel2Engine(input,90); for(let s=0;s<90;s++) engine.advance();
    const e=engine.evidence(), m=e.systems.monitors[0]!, b=e.systems.backends[0]!;
    expect([metrics[i]!.generated,metrics[i]!.exported,metrics[i]!.dropped,metrics[i]!.received,0]).toEqual([m.generated,m.exported,m.droppedBeforeExport,b.received,b.duplicates]);
    expect(metrics[i]!.latest).toEqual(b.latest);
    expect(metrics[i]!.collector!.every(r => r.state === "fresh")).toBe(true);
    expect(metrics[i]!.callers).toMatchObject({throughSecond:90,completed:180,failed:0});
    const row=rows[i]!, saved={...row,runInputs:JSON.parse(JSON.stringify(row.runInputs)),terminalSnapshot:JSON.parse(JSON.stringify(row.terminalSnapshot))};
    expect(buildRunReport(saved).terminal).toEqual(reports[i]!.terminal);
    expect(buildRunReport(saved).challenge).toEqual(reports[i]!.challenge);
    expect(reports[i]!.challenge!.predictions[0]!.actual).toBe("healthy");
  }
  console.info("monitoring-lab-calibration",JSON.stringify(metrics));
});
