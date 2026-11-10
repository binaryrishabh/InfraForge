import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { captureRunInputs } from "../deployments/runInputs";
import { reviewDesignChanges } from "../challenges/designChanges";
import { readPrediction } from "../challenges/prediction";
import { preflight } from "../challenges/preflight";
import { challengeSeed, specHash } from "../challenges/registry";
import { improvementSource } from "../challenges/improvements";
import { guidedReview } from "../challenges/guidedReview";
import { buildRunReport } from "../reports/report";
import { artifactAdmissionLabFixture } from "./artifactAdmissionLab.fixture";

test("artifact admission: one capacity edit creates usable later capacity; a Maximum-only near miss still refuses", () => {
  const {d, designs, rows} = artifactAdmissionLabFixture(), reports = rows.map(r => buildRunReport(r));
  expect(validateInfrastructureName(d.title)).toBeNull();
  expect(specHash(d)).toBe(/"admit-a-replica-image@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!);
  const inputs = designs.map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
  for (const s of designs) expect(preflight(d, s).errors).toEqual([]);
  for (const i of [1, 2]) expect(reviewDesignChanges(inputs[0]!, inputs[i]!)).toMatchObject({classification: "one-change", count: 1});
  expect(reviewDesignChanges(inputs[0]!, inputs[1]!).differences!.reconfigured[0]!.fields[0]!.field).toBe("artifactCachePolicy");
  expect(reviewDesignChanges(inputs[0]!, inputs[2]!).differences!.reconfigured[0]!.fields[0]!.field).toBe("autoscaling.maxReplicas");
  const restored = structuredClone(designs[1]!); restored.resources.find(r => r.id === "app")!.artifactCachePolicy!.capacityBytes = 256;
  expect(restored).toEqual(designs[0]!);
  const restoredNear = structuredClone(designs[2]!); restoredNear.resources.find(r => r.id === "app")!.autoscaling!.maxReplicas = 2;
  expect(restoredNear).toEqual(designs[0]!);
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  const data = reports.map(r => {
    const app = r.terminal!.resources.find(r => r.id === "app")!, startup = app.startup!, client = startup.clients!.find(c => c.id === "app#1/image")!, artifact = client.replicas![0]!, pool = startup.controllers![0]!;
    return {cpu: app.cpu, capacity: client.capacityBytes, required: artifact.requiredLayers!.reduce((n, b) => n + b.bytes, 0),
      refused: client.events!.filter(e => e.kind === "startup-failed").map(e => e.detail), cached: client.cachedBytes, pulled: client.pulledBytes,
      artifactAt: artifact.artifactReadyAtUs, listenerAt: pool.replicas![1]!.listenerReadyAtUs, desired: pool.desired, inService: pool.inService,
      callers: r.terminal!.traffic!.wholeRun!};
  });
  expect(data.map(r => [r.required, r.capacity, r.cached, r.pulled, r.artifactAt, r.listenerAt, r.desired, r.inService])).toEqual([
    [1024, 256, 0, 0, null, null, 2, 1], [1024, 4096, 1024, 1024, 11001071, 12001071, 2, 2], [1024, 256, 0, 0, null, null, 2, 1],
  ]);
  expect(data.map(r => r.cpu)).toEqual([60, 30, 60]);
  expect(data[0]!.refused).toEqual(Array(3).fill("node-blob-cache-capacity")); expect(data[2]!.refused).toEqual(data[0]!.refused); expect(data[1]!.refused).toEqual([]);
  expect(data[1]!.capacity! - data[1]!.required).toBe(3072);
  expect(20_000_000 - data[1]!.listenerAt!).toBeGreaterThan(7_000_000);
  for (const [i, row] of rows.entries()) {
    const m = data[i]!;
    expect(m.callers).toMatchObject({throughSecond: 20, completed: 4000, failed: 0, deadlineExceeded: 0, abandoned: 0, inFlight: 0});
    expect(m.cpu!).toBeLessThan(70);
    const initial = reports[i]!.terminal!.resources.find(r => r.id === "app")!.startup!.clients![0]!.replicas![0]!;
    expect(initial).toMatchObject({state: "pending", artifactReadyAtUs: null, attempts: 0});
    const replayed = buildRunReport({...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot))});
    expect(replayed.terminal).toEqual(reports[i]!.terminal); expect(replayed.challenge).toEqual(reports[i]!.challenge);
    expect(reports[i]!.challenge!.predictions[0]).toMatchObject({actual: "healthy", outcome: "matched"});
  }
  const types = designs[0]!.resources.map(r => r.type);
  expect(() => readPrediction({answers: {}}, d, types)).toThrow();
  expect(() => readPrediction({answers: {health: "artifact-ready"}}, d, types)).toThrow();
  expect(improvementSource(rows[0]!, d.id).input).toEqual(inputs[0]!);
  expect(reports[1]!.run.learning).toMatchObject({sourceRunId: rows[0]!.id, intent: "improvement", hypothesis: expect.stringContaining("node-blob-cache-capacity")});
  expect(guidedReview(reports[0]!, true, null)!.cues.some(c => c.id === "requirement:ready")).toBe(true);
  console.info("artifact-admission-calibration", JSON.stringify(data));
}, 120000);
