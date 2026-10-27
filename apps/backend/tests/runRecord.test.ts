import { expect, test } from "bun:test";
import { model1RunRecord } from "../runRecords/adapters";
import { readRunRecord } from "../runRecords/schema";
import { buildRunReport, type StoredRun } from "../reports/report";
import { captureRunInputs } from "../deployments/runInputs";
import { internalProductFixture } from "./model2Fixture";
import { layout, workload } from "./integration/scenario";

const time = new Date("2026-10-19T00:00:00Z");
function row(overrides: Partial<StoredRun> = {}): StoredRun {
  const input = captureRunInputs(layout, workload, "run-record-test");
  return { id: "run", infrastructureId: "design", status: "completed", resourceCount: layout.resources.length,
    createdAt: time, updatedAt: time, topologyRevision: 0, stages: [], timeline: [], chaosEvents: [],
    workloadProfile: input.workloadProfile, seed: input.seed, simulationState: null, runInputs: input, liveTopology: layout, ...overrides };
}
test("engineer and learner share the record and engine; prediction remains optional learner data", () => {
  const engineer = row(), prediction = { answers: { health: "healthy" } };
  const learner = row({ challengeId: "authored-challenge", challengeVersion: 1, challengePrediction: prediction, evaluationStopAtSimulatedSeconds: 120 });
  const e = model1RunRecord(engineer), l = model1RunRecord(learner);
  expect(e.schema).toBe(l.schema); expect(e.engine).toEqual(l.engine);
  expect(e.experiment.input).toEqual(l.experiment.input);
  expect(e.learning).toBeUndefined(); expect(l.learning?.prediction).toEqual(prediction);
  expect(l.experiment.horizonSeconds).toBe(120);
  expect(model1RunRecord({ ...learner, challengePrediction: null }).learning?.prediction).toBeUndefined();
});
test("legacy and malformed inputs stay readable without invented model versions, horizons or metrics", () => {
  const current = row(), input = current.runInputs as object;
  const legacy = model1RunRecord({ ...current, runInputs: { ...input, version: 1 } });
  expect(legacy.engine.version).toBeNull(); expect(legacy.experiment.inputSchema).toBe("infraforge-run-inputs/1");
  const missing = model1RunRecord({ ...current, runInputs: null });
  expect(missing.experiment).toEqual({ inputSchema: null, input: null, horizonSeconds: null });
  expect(missing.engine.version).toBeNull();
  expect(missing.evidence.unknown.join(" ")).toContain("No usable immutable run input");
});
test("adapting never mutates stored rows or the old Model-1 report", () => {
  const stored = row(), before = structuredClone(stored), old = buildRunReport(stored);
  expect(model1RunRecord(stored).evidence.report).toEqual(old);
  expect(stored).toEqual(before); expect(buildRunReport(stored)).toEqual(old);
});
test("unknown RunRecord versions and invalid horizons refuse rather than reinterpret", () => {
  const record = model1RunRecord(row());
  expect(readRunRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
  expect(() => readRunRecord({ ...record, schema: "infraforge-run-record/2" })).toThrow();
  expect(() => readRunRecord({ ...record, experiment: { ...record.experiment, horizonSeconds: 0 } })).toThrow();
});
