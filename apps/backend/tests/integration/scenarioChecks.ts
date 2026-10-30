import { expect } from "bun:test";
import { createModel2Run, dueScenarioSteps } from "@infraforge/simulation/model2-run";
import type { ChallengeScenario } from "@infraforge/contracts/challenges";
import type { RunReport } from "@infraforge/contracts/reports";
import { LocalHarness, until } from "./localHarness";
import { boundRetriesDuringSlowdownV1 as d } from "../../challenges/definitions/bound-retries-during-slowdown/v1";
import { REFERENCE } from "../challengeHarness";
import { submitBrowserRun } from "./browserRunChecks";
import type { Queue } from "bullmq";
import { checkScenarioRecovery } from "./scenarioRecoveryChecks";

export async function checkScenarioAttempts(h: LocalHarness, designs: string[], runs: string[], queue: Queue) {
  const workspace = (await h.request(`/challenges/${d.id}/workspace`, {}, "POST", 201)).designId;
  designs.push(workspace);
  const prediction = {answers: {health: "saturated"}, reasoning: null};
  // Keep a runnable topology but remove the exact scripted identity. Never substitute db-new.
  const renamed = structuredClone(d.starter!);
  renamed.resources.find(r => r.id === "db")!.id = "db-new";
  for (const line of renamed.connectionLines) if (line.targetId === "db") line.targetId = "db-new";
  await h.request(`/infrastructure/${workspace}`, {layout: {...renamed, layoutVersion: 3}}, "PUT");
  expect((await h.request(`/challenges/${d.id}/preflight`, {layout: renamed})).preflight.valid).toBe(false);
  await h.request(`/challenges/${d.id}/attempts`, {infrastructureId: workspace, prediction}, "POST", 400);

  const results: Array<{status: string; p95: number}> = [];
  for (const design of [d.starter!, REFERENCE[d.id]!]) {
    await h.request(`/infrastructure/${workspace}`, {layout: {...design, layoutVersion: 3}}, "PUT");
    const run = (await h.request(`/challenges/${d.id}/attempts`, {infrastructureId: workspace, prediction}, "POST", 201)).createdDeployment;
    runs.push(run.id);
    await until(async () => (await h.request(`/deployments/${run.id}`)).deployment.status === "browser" || undefined, "scenario browser ready", 30000, 200);
    const start = (await h.request(`/deployments/${run.id}/browser-run`)).browserRun;
    expect(start.challengeId).toBe(d.id); expect(start.scenario).toEqual(d.scenario);
    const scenario = start.scenario as ChallengeScenario, step = scenario.steps[0]!;
    await h.request(`/deployments/${run.id}/intervention`, step.request, "POST", 409);
    await h.request(`/deployments/${run.id}/intervention`, {...step.request, scenarioStepId: step.id}, "POST", 400);
    await h.request(`/deployments/${run.id}/submit`, {stopAtSecond: 5, actions: [{atSecond: 2, request: {kind: "intervention", parameters: step.request}}]}, "POST", 400);
    const browser = createModel2Run(start.input, start.horizonSeconds);
    let next = 0;
    for (let s = 1; s <= 5; s++) {
      browser.advance();
      for (const due of dueScenarioSteps(scenario, next, s)) {browser.apply({kind: "intervention", parameters: due.request}); next++;}
    }
    const official = await submitBrowserRun(h, run.id, 5);
    expect(official.terminalSnapshot.metrics).toEqual(JSON.parse(JSON.stringify(browser.view().metrics)));
    expect(official.terminalSnapshot.traffic).toEqual(browser.view().traffic);
    const report: RunReport = (await h.request(`/deployments/${run.id}/report`)).report;
    expect(report.actions.filter(a => a.scenarioStepId)).toMatchObject([{scenarioStepId: step.id, status: "completed", appliedSimulatedSeconds: 2, completedSimulatedSeconds: 5,
      outcome: {intervention: official.challengeScenario.receipts[0], interventionEnded: true}}]);
    results.push({status: report.challenge!.status, p95: report.terminal!.traffic!.latencyMs.p95!});
  }
  expect(results.map(r => r.status)).toEqual(["not-met", "met"]);
  expect(results[0]!.p95).toBeGreaterThan(1000); expect(results[1]!.p95).toBeLessThan(1000);
  await checkScenarioRecovery(h, workspace, runs, queue);
  return results;
}
