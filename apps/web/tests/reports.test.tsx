import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { RunReport, RunSummary } from "@infraforge/contracts/reports";
import { HistoryContent } from "../src/features/reports/components/RunList";
import { ReportContent } from "../src/features/reports/components/ReportContent";

const run: RunSummary = { id: "11111111-1111-4111-8111-111111111111", infrastructureId: "design",
  infrastructureName: "My saved architecture", status: "torn-down", createdAt: "2026-10-11T10:00:00.000Z",
  updatedAt: "2026-10-11T10:05:00.000Z", resourceCount: 2, workload: null, workloadSource: "unavailable",
  chaosEventCount: 0, topologyRevision: 0, hasReportData: false };
const report: RunReport = { version: 1, run, originalSeed: null, legacySeed: null, stages: [], timeline: [],
  chaosEvents: [], topology: { original: null, accepted: null, changes: null }, checkpoint: null,
  observed: [{ id: "status", message: "The stored run status is torn-down.", sources: ["status"] }],
  interpreted: [], unknown: ["No usable simulation checkpoint was retained."], inspectNext: ["Compare original inputs."] };
const render = (element: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>);
const retry = () => {};

test("history loading, empty and retry states are distinct and expose navigation", () => {
  const loading = render(<HistoryContent loading error={null} runs={[]} retry={retry} />);
  expect(loading).toContain('role="status"');
  expect(loading).toContain("Loading run history");
  expect(loading).not.toContain("No runs");
  const empty = render(<HistoryContent loading={false} error={null} runs={[]} retry={retry} />);
  expect(empty).toContain("No runs recorded yet");
  expect(empty).toContain('href="/design"');
  const error = render(<HistoryContent loading={false} error="History unavailable" runs={[run]} retry={retry} />);
  expect(error).toContain('role="alert"');
  expect(error).toContain("Try again");
  expect(error).not.toContain(run.infrastructureName);
});

test("history links actual runs with status and summary, and escapes historical names", () => {
  const html = render(<HistoryContent loading={false} error={null} runs={[{ ...run, infrastructureName: "<script>bad</script>" }]} retry={retry} />);
  expect(html).toContain(`href="/reports/${run.id}"`);
  expect(html).toContain("torn-down");
  expect(html).toContain("2 resources recorded");
  expect(html).toContain("0 chaos requests");
  expect(html).toContain("View inputs and evidence limits");
  expect(html).not.toContain("<script>");
});

test("report loading and safe unavailable states offer retry and history", () => {
  expect(render(<ReportContent loading error={null} data={null} retry={retry} />)).toContain("Loading recorded report");
  const error = render(<ReportContent loading={false} error="Run not available" data={null} retry={retry} />);
  expect(error).toContain('role="alert"');
  expect(error).toContain("Run not available");
  expect(error).toContain('href="/reports"');
  expect(error).toContain("Try again");
});

test("no-data reports show observations and limits without invented charts, health, cost or empty sections", () => {
  const html = render(<ReportContent loading={false} error={null} data={report} retry={retry} />);
  expect(html).toContain("Observed — recorded facts");
  expect(html).toContain("Unknown — evidence limits");
  expect(html).toContain("No usable stages, events or checkpoint data");
  expect(html).not.toContain("Deployment stages");
  expect(html).not.toContain("Chaos requests");
  expect(html).not.toContain("Latest retained simulation checkpoint");
  expect(html).not.toContain("Recorded cost estimates");
  expect(html).not.toContain("Interpreted —");
  expect(html).not.toContain("<table");
  expect(html).not.toContain("<svg");
});

test("checkpoint measurements, cost measures and chaos request limits are clearly separated", () => {
  const data: RunReport = { ...report,
    run: { ...run, hasReportData: true },
    stages: [{ name: "CostEstimate", status: "completed", message: "Stored estimate", startedAt: run.createdAt,
      completedAt: run.createdAt, warnings: [], issues: [], monthlyEstimateUsd: 10 }],
    chaosEvents: [{ timestamp: run.createdAt, type: "crash", resourceId: "db", message: "Requested crash" }],
    checkpoint: { simulatedSeconds: 60, accumulatedCostUsd: 0.004, resources: [{ id: "db", cpu: 92 }] },
    interpreted: [{ id: "cpu", message: "At most 10 percentage points of CPU headroom at this checkpoint.", sources: ["simulationState.metrics.db.cpu"] }],
  };
  const html = render(<ReportContent loading={false} error={null} data={data} retry={retry} />);
  expect(html).toContain("Interpreted — what the evidence supports");
  expect(html).toContain("92.0%");
  expect(html).toContain("—");
  expect(html).toContain("may predate the last controls or teardown");
  expect(html).toContain("$10.00");
  expect(html).toContain("$0.0040");
  expect(html).toContain("Neither is a cloud bill");
  expect(html).toContain("Full impact and recovery are not proven");
  expect(html).toContain("<details");
  expect(html).toContain("<summary");
  expect(html).not.toContain("final health");
});
