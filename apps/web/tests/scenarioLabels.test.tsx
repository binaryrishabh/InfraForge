import { expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ChallengeScenario } from "@infraforge/contracts/challenges";
import type { RunAction } from "@infraforge/contracts/actions";
import type { SimulationLog } from "@infraforge/contracts/telemetry";
import { DeploymentStatus, type Deployment } from "@infraforge/contracts/deployment";
import { ScenarioSchedule } from "../src/features/live/ScenarioSchedule";
import { LivePanel } from "../src/features/live/LivePanel";
import { ActionTimeline } from "../src/features/reports/components/ActionTimeline";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";
import { brief } from "./fixtures";
import { LiveWorkspace } from "../src/features/live/LiveWorkspace";
import * as deploymentSocket from "../src/features/deployment/hooks/useDeploymentSocket";
import * as challengeBrief from "../src/features/challenges/useChallengeBrief";
import * as media from "../src/lib/useMediaQuery";

const scenario: ChallengeScenario = { version: 1, visibility: "revealed", steps: [{ id: "db-slowdown", atSecond: 2, request: { interventionId: "cpu-capacity", revision: 1, target: { resourceId: "db" }, parameters: { cores: 0.5, duration: 2 } } }] };
const resources = [{ id: "db", type: "Database" as const, name: "Orders database", x: 0, y: 0 }];
const schedule = (value = scenario) => renderToStaticMarkup(<ScenarioSchedule deploymentId="run" scenario={value} resources={resources} />);

test("scenario application survives log eviction, ignores other runs and clears for a new run", () => {
  const sim = useSimulationStore.getInitialState();
  const previous = { deploymentId: sim.deploymentId, logs: sim.logs, appliedScenarioSteps: sim.appliedScenarioSteps };
  const snapshot = (logs: SimulationLog[], deploymentId = "run") => ({ deploymentId, timestamp: "", simulatedSeconds: 10, loadFraction: 1, health: "healthy" as const, metrics: {}, logs });
  const applied: SimulationLog = { timestamp: "", source: "model-2", severity: "info", message: "Scenario step applied: db-slowdown at second 2." };
  const view = () => {
    const current = useSimulationStore.getState();
    Object.assign(sim, { deploymentId: current.deploymentId, logs: current.logs, appliedScenarioSteps: current.appliedScenarioSteps });
    return schedule();
  };
  try {
    useSimulationStore.getState().prepareRun("run");
    useSimulationStore.getState().applySnapshot(snapshot([{ ...applied, source: "other" }]));
    expect(view()).toContain("Application: Unknown");
    useSimulationStore.getState().applySnapshot(snapshot([applied], "another-run"));
    expect(view()).toContain("Application: Unknown");
    useSimulationStore.getState().applySnapshot(snapshot([applied]));
    useSimulationStore.getState().applySnapshot(snapshot(Array.from({ length: 151 }, (_, i) => ({ ...applied, message: `Unrelated event ${i}` }))));
    expect(useSimulationStore.getState().logs).toHaveLength(150);
    expect(useSimulationStore.getState().logs.some(log => log.message === applied.message)).toBe(false);
    expect(view()).toContain("Applied at simulated second 2 (worker event)");
    expect(view()).toContain("Ended: Unknown");
    useSimulationStore.getState().prepareRun("run");
    expect(view()).toContain("Applied at simulated second 2 (worker event)");
    useSimulationStore.getState().prepareRun("new-run");
    expect(view()).toContain("Application: Unknown");
    expect(useSimulationStore.getState().appliedScenarioSteps).toEqual({});
    useSimulationStore.getState().reset();
    expect(useSimulationStore.getState().appliedScenarioSteps).toEqual({});
  } finally { Object.assign(sim, previous); useSimulationStore.getState().reset(); }
});

test("scenario schedule names the step, target and time without inferring application or end from the clock", () => {
  const sim = useSimulationStore.getInitialState(), previous = { deploymentId: sim.deploymentId, simulatedSeconds: sim.simulatedSeconds, appliedScenarioSteps: sim.appliedScenarioSteps };
  try {
    Object.assign(sim, { deploymentId: "run", simulatedSeconds: 10, appliedScenarioSteps: {} });
    const html = schedule();
    for (const text of ["db-slowdown", "Orders database", "Scheduled at simulated second 2", "Scheduled duration: 2 simulated seconds", "Application: Unknown", "Ended: Unknown"]) expect(html).toContain(text);
    sim.appliedScenarioSteps = { "db-slowdown": 2 };
    expect(schedule()).toContain("Applied at simulated second 2 (worker event)");
    expect(schedule()).toContain("Ended: Unknown");
    sim.deploymentId = "another-run";
    expect(schedule()).toContain("Application: Unknown");
  } finally { Object.assign(sim, previous); }
});

test("unrevealed and unavailable schedules do not expose step details", () => {
  expect(schedule({ ...scenario, visibility: "debrief" })).toBe("");
  expect(renderToStaticMarkup(<ScenarioSchedule deploymentId="run" resources={resources} />)).toBe("");
});

test("wide live workspace exposes the schedule once in an accessible group", () => {
  const run: Deployment = { id: "run", infrastructureId: null, runName: null, status: DeploymentStatus.BROWSER, resourceCount: 1, stages: [], timeline: [], chaosEvents: [], runInputs: null, liveTopology: { resources, connectionLines: [] }, topologyRevision: 0, createdAt: "", updatedAt: "", challengeId: brief.id, challengeVersion: brief.version };
  const socket = spyOn(deploymentSocket, "useDeploymentSocket").mockReturnValue({ deployment: run, status: DeploymentStatus.LIVE, completedStages: [], timeline: [] });
  const read = spyOn(challengeBrief, "useChallengeBrief").mockReturnValue({ request: null, data: { ...brief, scenario }, error: null, loading: false, retry: () => {} });
  const width = spyOn(media, "useMediaQuery").mockImplementation(query => query.includes("min-width"));
  try {
    const html = renderToStaticMarkup(<MemoryRouter><LiveWorkspace deploymentId="run" /></MemoryRouter>);
    expect(html.match(/Challenge schedule/g)).toHaveLength(1);
    expect(html).toContain('role="group" aria-label="Challenge scenario schedule"');
  } finally { socket.mockRestore(); read.mockRestore(); width.mockRestore(); }
});

test("live Attempt tab uses only the matching challenge version's revealed schedule", () => {
  const run: Deployment = { id: "run", infrastructureId: null, runName: null, status: DeploymentStatus.BROWSER, resourceCount: 1, stages: [], timeline: [], chaosEvents: [], runInputs: null, liveTopology: { resources, connectionLines: [] }, topologyRevision: 0, createdAt: "", updatedAt: "", challengeId: brief.id, challengeVersion: brief.version };
  const panel = (version: number) => renderToStaticMarkup(<MemoryRouter><LivePanel tab="controls" onTab={() => {}} deploymentId="run" run={run} status="live" completed={[]} timeline={[]} resources={resources} selected={undefined} brief={{ ...brief, version, scenario }} isLive /></MemoryRouter>);
  expect(panel(brief.version)).toContain("Challenge schedule");
  expect(panel(brief.version)).toContain("Orders database");
  expect(panel(brief.version + 1)).not.toContain("db-slowdown");
});

test("report timeline identifies scenario receipts and keeps application and ending distinct", () => {
  const request = scenario.steps[0]!.request;
  const action: RunAction = { id: "a1", deploymentId: "run", sequence: 1, kind: "intervention", scenarioStepId: "db-slowdown", parameters: request, status: "completed", requestedAt: "2026-10-31T00:00:00Z", appliedAt: "2026-10-31T00:00:02Z", completedAt: "2026-10-31T00:00:05Z", appliedSimulatedSeconds: 2, completedSimulatedSeconds: 5, failureReason: null, outcome: { intervention: { ...request, actionId: "a1", resolvedTargets: ["db/main"], affectedPaths: [], atUs: 2_000_001, endUs: 4_000_001 }, interventionEnded: true } };
  const html = renderToStaticMarkup(<ActionTimeline actions={[action]} />);
  for (const text of ["Scenario step: db-slowdown", "Scheduled by the challenge definition", "Applied / started", "simulated second 2", "baseline restore at 4000001 us", "Control completed"]) expect(html).toContain(text);
  const pending = renderToStaticMarkup(<ActionTimeline actions={[{ ...action, status: "requested", appliedAt: null, appliedSimulatedSeconds: null, completedAt: null, completedSimulatedSeconds: null, outcome: null }]} />);
  expect(pending).toContain("Scenario step: db-slowdown");
  expect(pending).toContain("No simulator application is recorded");
  expect(pending).not.toContain("Control completed");
  expect(renderToStaticMarkup(<ActionTimeline actions={[{ ...action, scenarioStepId: undefined }]} />)).not.toContain("Scenario step:");
});
