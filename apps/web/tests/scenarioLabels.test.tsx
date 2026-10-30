import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ChallengeScenario } from "@infraforge/contracts/challenges";
import type { RunAction } from "@infraforge/contracts/actions";
import { DeploymentStatus, type Deployment } from "@infraforge/contracts/deployment";
import { ScenarioSchedule } from "../src/features/live/ScenarioSchedule";
import { LivePanel } from "../src/features/live/LivePanel";
import { ActionTimeline } from "../src/features/reports/components/ActionTimeline";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";
import { brief } from "./fixtures";

const scenario: ChallengeScenario = { version: 1, visibility: "revealed", steps: [{ id: "db-slowdown", atSecond: 2, request: { interventionId: "cpu-capacity", revision: 1, target: { resourceId: "db" }, parameters: { cores: 0.5, duration: 2 } } }] };
const resources = [{ id: "db", type: "Database" as const, name: "Orders database", x: 0, y: 0 }];
const schedule = (value = scenario) => renderToStaticMarkup(<ScenarioSchedule deploymentId="run" scenario={value} resources={resources} />);

test("scenario schedule names the step, target and time without inferring application or end from the clock", () => {
  const sim = useSimulationStore.getInitialState(), previous = { deploymentId: sim.deploymentId, simulatedSeconds: sim.simulatedSeconds, logs: sim.logs };
  try {
    Object.assign(sim, { deploymentId: "run", simulatedSeconds: 10, logs: [] });
    const html = schedule();
    for (const text of ["db-slowdown", "Orders database", "Scheduled at simulated second 2", "Scheduled duration: 2 simulated seconds", "Application: Unknown", "Ended: Unknown"]) expect(html).toContain(text);
    sim.logs = [{ timestamp: "", source: "model-2", severity: "info", message: "Scenario step applied: db-slowdown at second 2." }];
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
