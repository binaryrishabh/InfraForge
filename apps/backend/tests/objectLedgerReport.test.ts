import { expect, test } from "bun:test";
import { LEARNING_REPORT_MEASUREMENTS } from "@infraforge/contracts/learning";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { captureRunInputs } from "../deployments/runInputs";
import { readRecords } from "../reports/records";
import { buildRunReport } from "../reports/report";
import { ObjectStorageSchema } from "../reports/objectStorageSchema";
import { checkLessonClaims } from "../learning/claims";
import { findLearningLesson } from "../learning/registry";
import { LEARNING_REGISTRY } from "../learning/registry";
import { definition } from "./challengeHarness";
import { objectReportCases } from "./objectLedgerReport.fixture";

const cases = objectReportCases();
const snapshot = (row: typeof cases.lifecycle.row) => row.terminalSnapshot as SimulationSnapshot;

test("real object output survives production capture, JSON, checkpoint and terminal without conflating put populations", () => {
  for (const fixture of [cases.lifecycle, ...cases.capacities, ...cases.duplicates]) {
    const last = fixture.samples.at(-1)!, limits: string[] = [];
    const records = readRecords(JSON.parse(JSON.stringify(fixture.row)), limits);
    expect(limits).toEqual([]);
    for (const checkpoint of [records.checkpoint!, records.terminal!, fixture.report.terminal!]) {
      expect(checkpoint.resources.find(r => r.id === "store")!.objectStorage).toEqual(last.metrics);
    }
    for (const {raw, metrics, second} of fixture.samples) {
      const {version: _v, sampledAtUs, objectCount, omittedObjects, objects, commandReasons, "object-capacity": refused, ...counters} = metrics;
      expect(sampledAtUs).toBe(second * 1000000);
      for (const [key, value] of Object.entries(counters)) expect(raw).toHaveProperty(key, value);
      expect(commandReasons).toEqual(raw.service.reasons);
      expect(refused).toBe(raw.service.reasons["object-capacity"] ?? null);
      expect(objectCount).toBe(raw.objects.length);
      expect(objects).toEqual(raw.objects.slice(0, 100).map(({namespace, key, bytes, generation}) => ({namespace, key, bytes, generation})));
      expect(omittedObjects).toBe(Math.max(0, raw.objects.length - 100));
      expect(raw.puts).toBe(raw.committedPuts + (raw.service.reasons["object-capacity"] ?? 0));
      expect(raw.storedBytes).toBe(raw.objects.reduce((sum, o) => sum + o.bytes, 0));
    }
  }
  const end = cases.lifecycle.samples.at(-1)!.metrics;
  expect(end).toMatchObject({puts: 5, committedPuts: 3, replacedObjects: 1, removedObjects: 1, deletes: 2, generation: 4,
    storedBytes: 1048576, "object-capacity": 2, commandReasons: {"object-capacity": 2, "precondition-failed": 2}});
  expect(cases.lifecycle.samples[0]!.metrics.objects!.find(o => o.key === "x")!.generation).toBe(2);
  expect(cases.lifecycle.samples[1]!.metrics.objects!.find(o => o.key === "x")!.generation).toBe(3);
  expect(cases.lifecycle.samples[4]!.metrics.objects).toEqual(cases.lifecycle.samples[1]!.metrics.objects);
});

test("one saved capacity control changes real commits/refusals; conditional result ownership changes replacements, not final bytes", () => {
  const [small, large] = cases.capacities, [plain, conditional] = cases.duplicates;
  const normalized = (fixture: typeof cases.lifecycle, field: "objectStoragePolicy" | "asyncWorker") => {
    const input = structuredClone(fixture.input);
    for (const r of input.resources) delete r[field];
    return input;
  };
  expect(normalized(small!, "objectStoragePolicy")).toEqual(normalized(large!, "objectStoragePolicy"));
  const a = small!.samples.at(-1)!.metrics, b = large!.samples.at(-1)!.metrics;
  expect(a["object-capacity"]).toBeGreaterThan(0);
  expect(b.commandReasons).toEqual({}); expect(b["object-capacity"]).toBeNull();
  expect(b.committedPuts!).toBeGreaterThan(a.committedPuts!);
  const p = plain!.samples.at(-1)!.metrics, c = conditional!.samples.at(-1)!.metrics;
  const oneChange = structuredClone(plain!.input);
  oneChange.resources.find(r => r.id === "worker")!.asyncWorker!.idempotentResults = true;
  expect(captureRunInputs(oneChange, oneChange.workloadProfile, oneChange.seed)).toEqual(conditional!.input);
  expect(p.replacedObjects!).toBeGreaterThan(0); expect(c.replacedObjects).toBe(0);
  expect(p.storedBytes).toBe(c.storedBytes); expect(p.objectCount).toBe(c.objectCount);
  expect(p.committedPuts! - c.committedPuts!).toBe(p.replacedObjects!);
  expect(c.commandReasons!["precondition-failed"]).toBe(p.replacedObjects!);
  console.info("object-report-capacity", JSON.stringify([a, b].map(m => ({capacityBytes: m.capacityBytes, storedBytes: m.storedBytes, committedPuts: m.committedPuts, refused: m["object-capacity"], commandReasons: m.commandReasons}))));
  console.info("object-report-replacement", JSON.stringify([p, c].map(m => ({storedBytes: m.storedBytes, puts: m.puts, committedPuts: m.committedPuts, replacements: m.replacedObjects, generation: m.generation, commandReasons: m.commandReasons}))));
});

test("older absent/partial object records preserve Unknown without backfill; malformed ownership and sample windows refuse terminal evidence", () => {
  const old = structuredClone(cases.lifecycle.row); delete snapshot(old).metrics.store!.objectStorage;
  expect(buildRunReport(old).terminal!.resources.find(r => r.id === "store")!.objectStorage).toBeUndefined();
  const m = cases.lifecycle.samples.at(-1)!.metrics;
  const historical = {version: 1 as const, storedBytes: m.storedBytes, capacityBytes: m.capacityBytes, committedPuts: m.committedPuts,
    replacedObjects: m.replacedObjects, removedObjects: m.removedObjects, deletes: m.deletes, "object-capacity": m["object-capacity"]};
  expect(ObjectStorageSchema.parse(historical)).toEqual(historical);
  const unknown = Object.fromEntries(Object.keys(m).map(k => [k, k === "version" ? 1 : null]));
  expect(ObjectStorageSchema.parse(unknown) as unknown).toEqual(unknown);
  for (const change of [{version: 2}, {puts: -1}, {generation: 0.5}, {storedBytes: Infinity}, {committedPuts: Number.MAX_SAFE_INTEGER + 1},
    {puts: 9}, {replacedObjects: 4}, {removedObjects: 3}, {objects: [...m.objects!, m.objects![0]!]},
    {objects: [{...m.objects![0]!, generation: 999}]}, {omittedObjects: 1}, {storedBytes: 1}, {overCapacity: true},
    {commandReasons: {...m.commandReasons, "object-capacity": 99}}, {objects: Array.from({length: 101}, () => m.objects![0]!)},
    {objects: [{...m.objects![0]!, content: "must not leak"}]}, {objects: [{...m.objects![0]!, key: "x".repeat(1025)}]},
    {sampledAtUs: 9999999}]) {
    const row = structuredClone(cases.lifecycle.row); Object.assign(snapshot(row).metrics.store!.objectStorage!, change);
    const report = buildRunReport(row);
    expect(report.terminal).toBeNull();
    expect(report.unknown.join(" ")).toContain("terminal record is malformed");
  }
});

test("claim gate accepts audited object readings and refuses total-put attempts, historic versions and durability claims", () => {
  const d = definition("leave-time-to-acknowledge"), source = findLearningLesson(d.id)!;
  if (source.kind !== "executable-lab") throw Error("Expected existing queue lab");
  const labels = Object.entries(LEARNING_REPORT_MEASUREMENTS).filter(([, m]) => m.path.startsWith("objectStorage.")).map(([label]) => label);
  expect(labels).toHaveLength(19);
  expect(checkLessonClaims({...source, experiment: {...source.experiment, evidenceToInspect: labels}}, d)).toEqual([]);
  for (const label of ["All attempted object puts", "Object version history", "Object durability percentage", "Exactly-once object effects"]) {
    expect(checkLessonClaims({...source, experiment: {...source.experiment, evidenceToInspect: [label]}}, d).join(" ")).toContain("report does not render measurement");
  }
});

test("registered conceptual check is grounded in a real refused replacement, without claiming a runnable designer experiment", () => {
  const lesson = findLearningLesson("replace-within-the-byte-budget")!;
  expect(lesson.kind).toBe("conceptual-exercise");
  expect(lesson.experiment).toBeNull();
  expect(checkLessonClaims(lesson)).toEqual([]);
  expect(LEARNING_REGISTRY.findTrack("data")!.modules.find(m => m.id === lesson.moduleId)!.lessonIds).toContain(lesson.id);
  expect(lesson.check!.correctChoiceId).toBe("retain");
  const replacement = cases.lifecycle.samples[1]!.metrics, refused = cases.lifecycle.samples[2]!.metrics;
  expect(replacement.objects!.find(o => o.key === "x")!.bytes).toBe(700000);
  expect(refused.objects).toEqual(replacement.objects);
  expect(refused.generation).toBe(replacement.generation);
  expect(refused.storedBytes).toBe(replacement.storedBytes);
  expect(refused.committedPuts).toBe(replacement.committedPuts);
  expect(refused.puts).toBe(replacement.puts! + 1);
  expect(refused.commandReasons!["object-capacity"]).toBe(1);
});
