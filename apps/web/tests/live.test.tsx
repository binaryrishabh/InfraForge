import { ActionTimeline } from "../src/features/reports/components/ActionTimeline";
import type { RunAction } from "@infraforge/contracts/actions";
import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { DeploymentStatus, type Deployment } from "@infraforge/contracts/deployment";
import { LivePanel } from "../src/features/live/LivePanel";
import { FaultControl } from "../src/features/live/controls/FaultControl";
import { runPhase, stopTarget } from "../src/features/live/runState";
import { FAULTS } from "../src/features/live/faults";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";
import { brief } from "./fixtures";

afterEach(() => useSimulationStore.getState().reset());
const run: Deployment = { id: "run", infrastructureId: "design", runName: "Cache matters", status: DeploymentStatus.LIVE, resourceCount: 2,
  stages: [], timeline: [], chaosEvents: [], runInputs: null, liveTopology: null, topologyRevision: 0, createdAt: "", updatedAt: "" };
const resources = [{ id: "vm1", type: "Virtual Machine" as const, x: 0, y: 0 }, { id: "lb", type: "Load Balancer" as const, x: 0, y: 0 }];
const panel = (r: Deployment, live = true) => renderToStaticMarkup(<MemoryRouter><LivePanel tab="controls" onTab={() => {}} deploymentId="run" run={r} status="live"
  completed={[]} timeline={[]} resources={resources} selected={undefined} brief={brief} isLive={live} /></MemoryRouter>);

test("a challenge attempt explains its fixed conditions and offers no load, fault or scaling controls", () => {
  const html = panel({ ...run, challengeId: "cache-matters", evaluationStopAtSimulatedSeconds: 150, challengePrediction: { answers: { database: "saturated", busiest: "Database" }, reasoning: null } });
  expect(html).toContain("Fixed conditions");
  expect(html).toContain("You can change the speed or stop.");
  expect(html).toContain("Your prediction is locked");
  expect(html).toContain("Saturated");
  expect(html).toContain("Judged at second 150");
  for (const control of ["Apply an intervention", "Target share of the workload", "Resize", "Pools"]) expect(html).not.toContain(control);
});

test("a freeform live run keeps its full durable controls", () => {
  const html = panel(run);
  for (const control of ["Load", "Target share of the workload", "Apply an intervention", "Resize", "Pools"]) expect(html).toContain(control);
  expect(panel(run, false)).toContain("Controls are available while the run is live.");
});

test("run phase and the automatic stop come from recorded run state", () => {
  expect(runPhase("live", false)).toBe("live");
  expect(runPhase("live", true)).toBe("stopping");
  expect(runPhase("torn-down", false)).toBe("finished");
  expect(runPhase("failed", false)).toBe("failed");
  expect(runPhase("Web Socket connection error", false)).toBe("connection");
  expect(stopTarget({ ...run, evaluationStopAtSimulatedSeconds: 150 })).toEqual({ seconds: 150, reason: "evaluation" });
  expect(stopTarget({ ...run, autoStopAtSimulatedSeconds: 620 })).toEqual({ seconds: 620, reason: "matched-stop" });
  expect(stopTarget(run)).toBeNull();
});

test("fault descriptions state the model's actual effect", () => {
  expect(FAULTS.find((f) => f.id === "cpu-spike")?.effect).toBe("A competing process holds 45% of the target's modeled cores.");
  expect(FAULTS.some((f) => f.id === "disk-failure" || f.id === "memory-leak")).toBe(false);
});
test("the live fault control offers the classic crash and CPU spike, never the options the engine refuses", () => {
  const html = renderToStaticMarkup(<FaultControl deploymentId="run" resources={resources} />);
  expect(html).toContain("Inject a classic fault");
  expect(html).toContain("Crash");
  expect(html).toContain("CPU spike");
  for (const refused of ["Memory leak", "memory-leak", "Disk failure", "disk-failure"]) expect(html).not.toContain(refused);
});

test("pool reset timeline shows applied one-shot with no restore window", () => {
  const request = {interventionId: "pool-reset", revision: 1, target: {edgeId: "app-db", direction: "both" as const}, parameters: {}};
  const action: RunAction = {id: "a1", deploymentId: "run", sequence: 1, kind: "intervention", parameters: request, status: "completed",
    requestedAt: "2026-10-30T00:00:00Z", appliedAt: "2026-10-30T00:00:01Z", completedAt: "2026-10-30T00:00:02Z", appliedSimulatedSeconds: 1, completedSimulatedSeconds: 2,
    outcome: {intervention: {...request, actionId: "a1", resolvedTargets: ["app-db:app:db"], affectedPaths: ["app-db:app:db"], atUs: 1_000_001, endUs: null}, interventionEnded: true}, failureReason: null};
  const html = renderToStaticMarkup(<ActionTimeline actions={[action]} />);
  for (const text of ["Reset connection pool v1", "Applied", "one-shot", "app-db:app:db"]) expect(html).toContain(text);
  expect(html).not.toContain("baseline restore at");
});
