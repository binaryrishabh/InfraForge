import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunReport } from "@infraforge/contracts/reports";
import { LEARNING_REPORT_MEASUREMENTS, evidenceLabels, type LearningLesson } from "@infraforge/contracts/learning";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { lessonRunMeasurements } from "../src/features/learning/runSummaryData";

const render = (report: RunReport) => renderToStaticMarkup(<ReportMeasurements report={report} number={3} />);
const labels = Object.keys(LEARNING_REPORT_MEASUREMENTS).filter(label => label.startsWith("VM memory:"));
const memory = (report: RunReport) => report.terminal!.resources.find(r => r.id === "app")!.vmMemory!.resources[0]!;
const mib = (value: number) => `${Number((value / 1048576).toFixed(3))} MiB`;

test("saved VM memory: engine counters render with resource identity and scoped learning labels; missing values stay Unknown", async () => {
  const process = Bun.spawn([Bun.which("bun")!, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/vmMemoryReport.fixture.ts")], {stdout: "pipe", stderr: "pipe"});
  const output = await new Response(process.stdout).text(), diagnostics = await new Response(process.stderr).text();
  expect(await process.exited, diagnostics).toBe(0);
  const {lessons, reports, missing, unknown, invalid, checkpointOnly, noSnapshot} = JSON.parse(output) as {
    lessons: Array<{old: LearningLesson; current: LearningLesson}>;
    reports: RunReport[]; missing: RunReport; unknown: RunReport; invalid: RunReport; checkpointOnly: RunReport; noSnapshot: RunReport;
  };
  expect(reports).toHaveLength(4);
  expect(reports.every(report => report.challenge!.version === 2)).toBe(true);
  expect(labels).toHaveLength(7);
  // The old wording describes an actual gap; the new versions name the now-rendered block.
  expect(lessons).toHaveLength(2);
  for (const {old, current} of lessons) {
    expect(old.contentVersion).toBe(1); expect(current.contentVersion).toBe(current.id === "fit-a-request-in-memory" ? 3 : 2);
    expect(old.explanation.join(" ")).toMatch(/omits the detailed memory block|does not render those detailed counters/);
    expect(current.explanation.join(" ")).toContain("Refused allocations");
    expect(current.explanation.join(" ")).toContain("memory measurements");
    expect(current.limitations.join(" ")).toContain("Missing or null");
    expect(current.limitations.join(" ")).not.toMatch(/does not display|no report renderer/);
    expect(render(reports[0]!)).toContain("Refused allocations");
    expect(render(reports[0]!)).toContain("memory measurements");
  }
  const lab = lessons.find(({current}) => current.kind === "executable-lab")!.current;
  const memoryEvidence = lab.experiment!.evidenceToInspect!.flatMap(evidenceLabels).filter(label => label.startsWith("VM memory:"));
  expect(memoryEvidence).toEqual(labels);
  for (const report of reports) {
    const html = render(report), m = memory(report);
    expect(html).toContain('aria-label="Memory measurements for app"');
    expect(html).toContain("Modeled resident memory (from your numbers)");
    for (const label of labels) expect(html).toContain(`>${label.replace("VM memory: ", "")}<`);
    for (const value of [m.residentBytes, m.limitBytes, m.headroomBytes, m.peakResidentBytes]) expect(html).toContain(mib(value!));
    const summary = lessonRunMeasurements(report, labels);
    for (const [label, field] of [["Resident", "residentBytes"], ["Limit", "limitBytes"], ["Headroom", "headroomBytes"],
      ["Peak resident", "peakResidentBytes"], ["Holding requests", "holdingRequests"], ["Active requests", "activeRequests"], ["Refused allocations", "allocationRejected"]] as const) {
      const bytes = ["residentBytes", "limitBytes", "headroomBytes", "peakResidentBytes"].includes(field);
      expect(summary.find(row => row.label === `VM memory: ${label}`)!.value).toBe(`app / app: ${m[field]}${bytes ? " bytes" : ""}`);
    }
    expect(report.terminal!.resources.find(r => r.id === "app")!.memory).toBeUndefined();
  }
  // Same existing lab, one instance-size change at a time: headroom is a recorded snapshot, not a production sizing guarantee.
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "met", "met"]);
  expect(memory(reports[0]!).allocationRejected!).toBeGreaterThan(0);
  expect(memory(reports[1]!).limitBytes).toBe(4096 * 1048576);
  expect(memory(reports[2]!).limitBytes).toBe(8192 * 1048576);
  expect(reports[1]!.terminal!.traffic!.wholeRun!.completed).toBe(reports[2]!.terminal!.traffic!.wholeRun!.completed);
  expect(render(missing)).not.toContain('aria-label="Memory measurements for app"');
  expect(lessonRunMeasurements(missing, labels).every(row => row.value.endsWith("Unknown"))).toBe(true);
  expect(render(unknown)).toMatch(/Resident<\/dt><dd[^>]*>Unknown/);
  expect(render(unknown)).toContain(mib(memory(unknown).limitBytes!));
  expect(lessonRunMeasurements(unknown, ["VM memory: Resident"])[0]!.value).toBe("app / app: Unknown");
  expect(invalid.terminal).toBeNull();
  expect(render(invalid)).not.toContain('aria-label="Memory measurements for app"');
  expect(checkpointOnly.terminal).toBeNull(); expect(render(checkpointOnly)).toContain("Latest retained simulation checkpoint");
  expect(render(checkpointOnly)).toContain('aria-label="Memory measurements for app"');
  expect(lessonRunMeasurements(checkpointOnly, labels).every(row => row.value.endsWith("Unknown"))).toBe(true);
  expect(noSnapshot.terminal).toBeNull(); expect(noSnapshot.checkpoint).toBeNull();
  expect(render(noSnapshot)).not.toContain("Modeled resident memory");
  expect(lessonRunMeasurements(noSnapshot, labels).every(row => row.value.endsWith("Unknown"))).toBe(true);
  console.info(JSON.stringify({lab: "fit-a-request-in-memory", variants: reports.map((r, i) => ({variant: ["small", "medium", "large", "smaller-request"][i],
    memory: memory(r), cpu: r.terminal!.resources.find(r => r.id === "app")!.cpu, cost: r.stages.find(s => s.name === "CostEstimate")!.monthlyEstimateUsd,
    p95: r.terminal!.traffic!.latencyMs.p95, health: r.terminal!.health, completed: r.terminal!.traffic!.wholeRun!.completed, verdict: r.challenge!.status}))}));
}, 60000);
