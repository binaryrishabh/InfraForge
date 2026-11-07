import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { LEARNING_REPORT_MEASUREMENTS, learningMeasurement } from "@infraforge/contracts/learning";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { captureRunInputs } from "../deployments/runInputs";
import { compareInputs } from "../comparison/inputs";
import { buildRunReport } from "../reports/report";
import { challengeSeed, specHash } from "../challenges/registry";
import { preflight } from "../challenges/preflight";
import { checkLessonClaims } from "../learning/claims";
import { learningContent } from "../learning/content";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

const id = "fit-a-request-in-memory";
const app = (design: ChallengeStarter) => design.resources.find(r => r.id === "app")!;
const raw = (row: ReturnType<typeof attemptRow>) => row.terminalSnapshot as SimulationSnapshot & {metricsTopologyRevision: number};
const memory = (report: ReturnType<typeof buildRunReport>, resourceId = "app") => report.terminal!.resources.find(r => r.id === resourceId)!.vmMemory!.resources[0]!;

function secondMemoryVm(start: ChallengeStarter): ChallengeStarter {
  const near = structuredClone(start);
  near.resources.push({...structuredClone(app(start)), id: "app2", y: app(start).y + 168});
  near.connectionLines.push({...start.connectionLines[0]!, id: "lb-app2", targetId: "app2"},
    {...start.connectionLines[1]!, id: "app2-db", sourceId: "app2"});
  return near;
}

test("fit-a-request-in-memory: controlled size and request-memory runs pass; a second identical VM still fails", () => {
  const d = definition(id), start = d.starter!, fixed = REFERENCE[id]!, reduced = REFERENCE[`${id}-request`]!, near = secondMemoryVm(start);
  const restoredSize = structuredClone(fixed); app(restoredSize).size = app(start).size; expect(restoredSize).toEqual(start);
  const restoredRequest = structuredClone(reduced); app(restoredRequest).vmMemory!.requestMiB = app(start).vmMemory!.requestMiB; expect(restoredRequest).toEqual(start);
  expect(near.resources.filter(r => r.id !== "app2")).toEqual(start.resources);
  expect(near.connectionLines.filter(c => c.sourceId !== "app2" && c.targetId !== "app2")).toEqual(start.connectionLines);
  expect(validateInfrastructureName(d.title)).toBeNull(); expect(d.hints).toHaveLength(3);
  const pin = new RegExp(`"${id}@${d.version}": "([a-f0-9]{64})"`).exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!;
  expect(specHash(d)).toBe(pin);
  const captured = captureRunInputs(start, d.workload, challengeSeed(d));
  for (const design of [start, fixed, reduced, near]) {
    expect(preflight(d, design).errors).toEqual([]);
    const input = captureRunInputs(design, d.workload, challengeSeed(d));
    expect(input.workloadProfile).toEqual(captured.workloadProfile); expect(input.seed).toBe(captured.seed);
    expect(input.catalogSnapshot).toBe(captured.catalogSnapshot); expect(input.adapterProfiles).toEqual(captured.adapterProfiles);
  }
  const change = compareInputs(captured, captureRunInputs(reduced, d.workload, challengeSeed(d)));
  expect(change).toMatchObject({grade: "one-change-design", design: {reconfigured: [{id: "app", fields: [{field: "vmMemory"}]}]}});
  const rows = [start, fixed, reduced, near].map(design => attemptRow(d, design, answers(d, {"database-health": "healthy"})));
  const reports = rows.map(row => buildRunReport(row));
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "met", "not-met"]);
  for (const [index, report] of reports.entries()) {
    const m = memory(report), traffic = report.terminal!.traffic!;
    expect(report.terminal!.simulatedSeconds).toBe(6); expect(report.actions).toEqual([]);
    expect(report.challenge!.predictions[0]).toMatchObject({actual: "healthy", outcome: "matched"});
    expect(m.headroomBytes).toBe(m.limitBytes! - m.residentBytes!);
    expect(m.comparison).toBe("within"); expect(m.holdingRequests).toBe(0); expect(m.activeRequests).toBe(0);
    expect(report.terminal!.resources.find(r => r.id === "app")!.memory).toBeUndefined();
    const reread = buildRunReport({...rows[index]!, terminalSnapshot: JSON.parse(JSON.stringify(rows[index]!.terminalSnapshot)), runInputs: JSON.parse(JSON.stringify(rows[index]!.runInputs))});
    expect(reread.terminal).toEqual(report.terminal); expect(reread.challenge).toEqual(report.challenge);
    if (index === 0 || index === 3) {
      expect(traffic.wholeRun).toMatchObject({completed: 0, failed: 600, deadlineExceeded: 0, abandoned: 0, inFlight: 0});
      expect(traffic.latencyMs.p95).toBeNull();
      expect(report.terminal!.resources.find(r => r.id === "app")!.cpu).toBe(0);
      expect(m.residentBytes).toBe(1024 * 1048576); expect(m.peakResidentBytes).toBe(m.residentBytes);
      expect(m.limitBytes).toBe(2048 * 1048576);
      expect(m.allocationRejected!).toBeGreaterThan(0); expect(m.allocationRejected!).toBeLessThan(traffic.wholeRun!.failed);
      expect(m.headroomBytes!).toBeLessThan(app(start).vmMemory!.requestMiB * 1048576);
      expect(report.terminal!.resources.find(r => r.id === "lb")!.health).toBe("failed");
    } else {
      expect(traffic.wholeRun).toMatchObject({completed: 600, failed: 0, deadlineExceeded: 0, abandoned: 0, inFlight: 0});
      expect(traffic.latencyMs.p95!).toBeGreaterThan(0); expect(traffic.latencyMs.p95!).toBeLessThan(10);
      expect(m.allocationRejected).toBe(0); expect(m.peakResidentBytes!).toBeGreaterThan(m.residentBytes!);
      expect(m.peakResidentBytes!).toBeLessThan(m.limitBytes!);
      expect(report.terminal!.resources.find(r => r.id === "app")!.cpu!).toBeLessThan(40);
    }
  }
  expect(memory(reports[1]!).limitBytes).toBe(8192 * 1048576);
  expect(memory(reports[2]!).limitBytes).toBe(memory(reports[0]!).limitBytes);
  expect(memory(reports[3]!, "app2").allocationRejected!).toBeGreaterThan(0);
  console.info("VM memory lab", JSON.stringify(reports.map(r => ({status: r.challenge!.status, callers: r.terminal!.traffic!.wholeRun,
    p95: r.terminal!.traffic!.latencyMs.p95, cpu: r.terminal!.resources.find(v => v.id === "app")!.cpu, memory: memory(r)}))));

  for (const mutate of [
    (row: typeof rows[number]) => { row.terminalSnapshot = null; },
    (row: typeof rows[number]) => { raw(row).simulatedSeconds--; },
    (row: typeof rows[number]) => { raw(row).metricsTopologyRevision++; },
    (row: typeof rows[number]) => { delete raw(row).traffic; },
    (row: typeof rows[number]) => { delete raw(row).traffic!.wholeRun; },
    (row: typeof rows[number]) => { raw(row).traffic!.wholeRun!.throughSecond--; },
    (row: typeof rows[number]) => { raw(row).traffic!.wholeRun!.completed = -1; },
    (row: typeof rows[number]) => { raw(row).traffic!.wholeRun!.failed = Number.MAX_SAFE_INTEGER + 1; },
    (row: typeof rows[number]) => { row.runInputs = null; row.liveTopology = null; },
  ]) {
    const bad = structuredClone(rows[1]!); mutate(bad);
    expect(buildRunReport(bad).challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-evaluated");
    expect(buildRunReport(bad).challenge!.status).not.toBe("met");
  }
  for (const key of ["failed", "deadlineExceeded", "abandoned"] as const) {
    const bad = structuredClone(rows[1]!); raw(bad).traffic!.wholeRun![key] = 1;
    expect(buildRunReport(bad).challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-met");
  }
  const absent = structuredClone(rows[1]!); delete raw(absent).metrics.app!.vmMemory;
  expect(buildRunReport(absent).terminal!.resources.find(r => r.id === "app")!.vmMemory).toBeUndefined();
  // This is a caller-outcomes criterion, not a fabricated memory-budget criterion.
  expect(buildRunReport(absent).challenge!.status).toBe("met");
  const unknown = structuredClone(rows[1]!);
  Object.assign(raw(unknown).metrics.app!.vmMemory!.resources[0]!, {residentBytes: null, headroomBytes: null, comparison: "unknown"});
  expect(memory(buildRunReport(unknown)).residentBytes).toBeNull();
  const malformed = structuredClone(rows[1]!); raw(malformed).metrics.app!.vmMemory!.resources[0]!.allocationRejected = -1;
  expect(buildRunReport(malformed).terminal).toBeNull(); expect(buildRunReport(malformed).challenge!.status).not.toBe("met");
  const invalid = structuredClone(start); app(invalid).vmMemory!.requestMiB = -1;
  expect(preflight(d, invalid).valid).toBe(false);
});

test("VM memory saved fields have scoped labels accepted by the report claim gate", () => {
  const d = definition(id), original = learningContent.lessons.find(l => l.id === id)!;
  expect(original.kind).toBe("executable-lab"); expect(checkLessonClaims(original, d)).toEqual([]);
  const reportRenderer = readFileSync(new URL("../../web/src/features/reports/components/ReportMeasurements.tsx", import.meta.url), "utf8");
  expect(reportRenderer).toContain("<VmMemoryReadings metrics={r.vmMemory}");
  const liveRenderer = readFileSync(new URL("../../web/src/features/live/VmMemoryReadings.tsx", import.meta.url), "utf8");
  for (const [label, field] of [["Resident", "residentBytes"], ["Limit", "limitBytes"], ["Headroom", "headroomBytes"],
    ["Holding requests", "holdingRequests"], ["Active requests", "activeRequests"], ["Refused allocations", "allocationRejected"], ["Peak resident", "peakResidentBytes"]]) {
    expect(liveRenderer).toContain(`"${label}"`); expect(liveRenderer).toContain(`r.${field}`);
    const scoped = `VM memory: ${label}`;
    expect(learningMeasurement(scoped)).toMatchObject({path: `vmMemory.resources.*.${field}`, resourceType: "Virtual Machine"});
    expect(learningMeasurement(label!)).toBeNull(); // Unqualified labels remain ambiguous.
    const accepted = structuredClone(original); accepted.experiment!.evidenceToInspect = [scoped];
    expect(checkLessonClaims(accepted, d)).toEqual([]);
    const bad = structuredClone(original); bad.experiment!.evidenceToInspect = [label!];
    expect(checkLessonClaims(bad, d)).toContain(`${id}@${original.contentVersion}: report does not render measurement ${label}`);
  }
  expect(Object.values(LEARNING_REPORT_MEASUREMENTS).filter(m => m.path.includes("vmMemory"))).toHaveLength(7);
});
