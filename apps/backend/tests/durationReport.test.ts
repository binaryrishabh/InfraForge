import { expect, test } from "bun:test";
import { DurationEvidenceSchema } from "../reports/durationSchema";
import { durationSnapshot } from "../simulator/durationSnapshot";
import { durationReportFixture, realDurationSource } from "./durationReport.fixture";
import { checkLessonClaims } from "../learning/claims";
import { findLearningLesson } from "../learning/registry";
import { definition } from "./challengeHarness";

test("owned engine durations survive capture, JSON and saved report parsing without altering live output", () => {
  const f = durationReportFixture();
  f.reports.forEach((report, i) => expect(report.terminal!.durationEvidence).toEqual(f.captures[i]));
  f.finiteReports.forEach((report, i) => expect(report.checkpoint!.durationEvidence).toEqual(f.finiteEvidence[i]));
  const {run, source} = realDurationSource(), before = run.view(), saved = durationSnapshot(source);
  expect(run.view()).toEqual(before); expect(run.evidence()).toEqual(source);
  for (const row of saved.resources) {
    const raw = source.resources.find(r => r.id === row.id)!;
    expect(row.busySlotUs).toBe(raw.busySlotUs); expect(row.consumedCoreUs).toBe(raw.consumedCoreUs);
    expect(row.phasesUs).toBeNull();
  }
  for (const row of saved.paths) {
    const raw = source.network.paths.find(p => p.id === row.id)!;
    expect(row.reachedPhaseUs).toEqual(raw.completedPhaseDurationsUs);
    expect(row).toMatchObject({source: raw.source, target: raw.target, pendingAcquisitions: raw.pool.pending});
    expect(row.unfinishedAcquisitionUs).toBeNull();
  }
  expect(saved.paths.find(p => p.target === "db")!.reachedPhaseUs.connectionWaitUs).toBeGreaterThan(0);
  expect(f.reports[1]!.terminal!.durationEvidence!.resources.some(r => r.kind === "async-worker" && r.busySlotUs! > 0 && r.phasesUs === null)).toBe(true);
  expect(f.missing.terminal!.durationEvidence).toBeUndefined();
  expect(f.nullHold.terminal!.durationEvidence!.resources[0]!.busySlotUs).toBeNull();
  expect(f.invalid.terminal).toBeNull(); expect(f.duplicate.terminal).toBeNull();
  console.info(JSON.stringify({product: saved, finite: f.finiteEvidence.map(e => ({throughUs: e.throughUs, resources: e.resources}))}));
});

test("finite-IO active phases conserve measured hold, including live partial and cancelled work; mismatch fails", () => {
  const {finiteEvidence} = durationReportFixture();
  for (const e of finiteEvidence) for (const r of e.resources.filter(r => r.phasesUs)) {
    const {queued: _queued, ...held} = r.phasesUs!;
    expect(Object.values(held).reduce((a, b) => a + b, 0)).toBeCloseTo(r.busySlotUs!, 6);
    const bad = structuredClone(e); bad.resources.find(row => row.id === r.id)!.phasesUs!.io++;
    expect(DurationEvidenceSchema.safeParse(bad).success).toBe(false);
  }
  for (const phase of ["queued", "lock", "cpu", "io", "wait", "commit"] as const) {
    expect(finiteEvidence.some(e => e.resources.some(r => r.phasesUs && r.phasesUs[phase] > 0))).toBe(true);
  }
  const cancelled = finiteEvidence.at(-1)!.resources[0]!;
  expect(cancelled.cancelled).toBe(1); expect(cancelled.phasesUs!.io).toBeGreaterThan(0);
  expect(finiteEvidence.some(e => e.resources.some(r => r.phasesUs && r.busySlotUs! > 0))).toBe(true);
});

test("bounded capture reports omitted owners and paths; missing owner state remains Unknown", () => {
  const {source} = realDurationSource();
  const expanded = {...source, computeConfiguration: Array.from({length: 70}, (_, i) => ({id: `absent-${i}`})),
    network: {...source.network, paths: Array.from({length: 70}, (_, i) => ({...source.network.paths[0]!, id: `path-${i}`}))}};
  const e = durationSnapshot(expanded);
  expect(e.resources).toHaveLength(64); expect(e.resourcesOmitted).toBe(7); // 70 compute owners plus DB
  expect(e.paths).toHaveLength(64); expect(e.pathsOmitted).toBe(6);
  expect(e.resources.every(r => r.busySlotUs === null && r.phasesUs === null)).toBe(true);
});

test("claim gate accepts measured path duration labels and refuses invented worker-phase duration labels", () => {
  const lesson = structuredClone(findLearningLesson("diagnose-query-admission")!);
  lesson.experiment!.evidenceToInspect = ["Duration: Slot hold; Duration: Acquired pool wait"];
  expect(checkLessonClaims(lesson, definition("diagnose-query-admission"))).toEqual([]);
  lesson.experiment!.evidenceToInspect.push("Duration: Worker acknowledgement wait");
  expect(checkLessonClaims(lesson, definition("diagnose-query-admission")).join(" ")).toContain("report does not render measurement Duration: Worker acknowledgement wait");
});
