import { expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { RunReport, RunSummary } from "@infraforge/contracts/reports";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { HistoryContent } from "../src/features/reports/components/RunList";
import { ReportContent } from "../src/features/reports/components/ReportContent";
import * as dialogs from "../src/ui/ConfirmDialogs";
import { http, API_URL } from "../src/client/httpClient";
import { reenterRun } from "../src/features/live/reenterRun";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";

const run: RunSummary = { id: "11111111-1111-4111-8111-111111111111", infrastructureId: "design",
  infrastructureName: "My saved architecture", status: "torn-down", createdAt: "2026-10-11T10:00:00.000Z",
  updatedAt: "2026-10-11T10:05:00.000Z", resourceCount: 2, workload: null, workloadSource: "unavailable",
  chaosEventCount: 0, topologyRevision: 0, hasReportData: false };
const report: RunReport = { version: 1, run, originalSeed: null, legacySeed: null, stages: [], timeline: [],
  chaosEvents: [], topology: { original: null, accepted: null, changes: null }, checkpoint: null,
  terminal: null, actions: [], provenance: { inputVersion: 1, simulationModelVersion: null, catalogSnapshot: null },
  observed: [{ id: "status", message: "The stored run status is torn-down.", sources: ["status"] }],
  interpreted: [], unknown: ["No usable simulation checkpoint was retained."], inspectNext: ["Compare original inputs."] };
const render = (element: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>);
const retry = () => {};

test("live reports and history reopen the exact run and reports offer a stop control", async () => {
  const live = { ...run, status: "live" };
  const history = render(<HistoryContent loading={false} error={null} runs={[live]} retry={retry} />);
  const detail = render(<ReportContent loading={false} error={null} data={{ ...report, run: live }} retry={retry} />);
  for (const html of [history, detail]) {
    expect(html).toContain(`href="/design?run=${run.id}"`);
    expect(html).toContain("Open live run");
  }
  expect(detail).toContain("Stop run</button>");
  const stopped = render(<ReportContent loading={false} error={null} data={report} retry={retry} />);
  expect(stopped).not.toContain("Open live run");
  expect(stopped).not.toContain("Stop run</button>");

  const Original = dialogs.ConfirmDialog;
  let confirm: (() => void) | undefined;
  const dialog = spyOn(dialogs, "ConfirmDialog").mockImplementation((props) => {
    if (props.title === "Stop this run?") confirm = props.onConfirm;
    return <Original {...props} />;
  });
  const post = spyOn(http, "post").mockResolvedValue({ data: { action: { id: "stop", status: "requested" } } });
  const topology = { resources: [{ id: "api", type: "Virtual Machine", x: 0, y: 0 }], connectionLines: [] };
  const get = spyOn(http, "get").mockResolvedValue({ data: { deployment: { id: run.id, status: "live", liveTopology: topology,
    topologyRevision: 3, infrastructureId: "design", runName: "Recorded name", challengeId: null } } });
  const auth = useAuthStore.getState();
  const canvas = useCanvasStore.getState();
  try {
    render(<ReportContent loading={false} error={null} data={{ ...report, run: live }} retry={retry} />);
    expect(post).not.toHaveBeenCalled();
    expect(confirm).toBeDefined();
    await confirm!();
    expect(post).toHaveBeenCalledWith(`${API_URL}/deployments/${run.id}/teardown`);
    useAuthStore.setState({ user: { id: "alice", name: "Alice", username: null, email: "alice@example.test", emailVerified: true, createdAt: run.createdAt } });
    await reenterRun(run.id);
    expect(get).toHaveBeenCalledWith(`${API_URL}/deployments/${run.id}`);
    expect(useCanvasStore.getState()).toMatchObject({ activeDeploymentId: run.id, resources: topology.resources, topologyRevision: 3, currentLayoutName: "Recorded name", liveLocked: false });
    useCanvasStore.getState().clearCanvas();
    const cancelled = new AbortController(); cancelled.abort();
    await reenterRun(run.id, undefined, cancelled.signal);
    expect(useCanvasStore.getState().activeDeploymentId).toBeNull();
  } finally { dialog.mockRestore(); post.mockRestore(); get.mockRestore(); useAuthStore.setState(auth); useCanvasStore.setState(canvas); }
});

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
  expect(html).toContain(`href="/runs/${run.id}"`);
  expect(html).toContain("Stopped");
  expect(html).toContain("Freeform run");
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
  expect(error).toContain('href="/runs"');
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
  expect(html).not.toContain("<polyline");
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
  expect(html).toContain("Recorded resource measurements");
  expect(html).not.toContain("final health");
});

test("durable timeline distinguishes requests, running faults, completion and unproven recovery", () => {
  const data: RunReport = { ...report, actions: [
    { id: "requested", deploymentId: run.id, sequence: 1, kind: "load", parameters: { targetLoadFraction: 1 },
      status: "requested", requestedAt: run.createdAt, appliedAt: null, completedAt: null,
      appliedSimulatedSeconds: null, completedSimulatedSeconds: null, outcome: null, failureReason: null },
    { id: "ended", deploymentId: run.id, sequence: 2, kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "db" },
      status: "completed", requestedAt: run.createdAt, appliedAt: run.createdAt, completedAt: run.updatedAt,
      appliedSimulatedSeconds: 10, completedSimulatedSeconds: 30,
      outcome: { durationSimulatedSeconds: 20, faultEnded: true, observedOverallHealth: "critical" }, failureReason: null },
  ] };
  const html = render(<ReportContent loading={false} error={null} data={data} retry={retry} />);
  expect(html).toContain("No simulator application is recorded");
  expect(html).toContain("Applied / started");
  expect(html).toContain("simulated second 30");
  expect(html).toContain("Injected fault ended");
  expect(html).toContain("does not establish full system recovery");
  // Actions, states and faults read as words, not stored identifiers.
  expect(html).toContain("Load change");
  expect(html).toContain("Requested");
  expect(html).toContain("Crash on db");
  expect(html).not.toContain(">requested<");
});

test("exact terminal snapshot and deleted-design history are labelled honestly", () => {
  const data: RunReport = { ...report, run: { ...run, infrastructureId: null },
    terminal: { capturedAt: run.updatedAt, topologyRevision: 2, simulatedSeconds: 30, health: "healthy", resources: [] } };
  const html = render(<ReportContent loading={false} error={null} data={data} retry={retry} />);
  expect(html).toContain("Exact terminal simulation snapshot");
  expect(html).toContain("Captured");
  expect(html).toContain("topology revision: 2");
  expect(html).not.toContain("Latest retained simulation checkpoint");
  const history = render(<HistoryContent loading={false} error={null} runs={[data.run]} retry={retry} />);
  expect(history).toContain("Saved design deleted; run history retained");
});
