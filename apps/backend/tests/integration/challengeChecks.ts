import { rejects } from "node:assert/strict";
import { expect } from "bun:test";
import type { ChallengeBrief, ChallengeSummary } from "@infraforge/contracts/challenges";
import type { RunReport } from "@infraforge/contracts/reports";
import { LocalHarness, until } from "./localHarness";
import { SessionFixtures } from "./sessionFixtures";
import { layout } from "./scenario";
import { challengeSeed, latestChallenge } from "../../challenges/registry";
import { REFERENCE } from "../challengeHarness";

export async function checkChallengeAttempts(harness: LocalHarness, sessions: SessionFixtures, designs: string[], runs: string[]) {
  const cookie = harness.cookie;
  const { definition, hash } = latestChallenge("first-production-api")!;
  const read = async (id: string) => (await harness.sql.query('SELECT * FROM "Deployment" WHERE id=$1', [id])).rows[0];
  const counts = async () => (await harness.sql.query('SELECT (SELECT count(*) FROM "Deployment") AS runs, (SELECT count(*) FROM "Outbox") AS events')).rows[0];
  const brief = async (): Promise<ChallengeBrief> => (await harness.request(`/challenges/${definition.id}`)).challenge;
  const prediction = { answers: { health: "healthy", busiest: "Virtual Machine" }, reasoning: "Two servers split the load." };

  const listed: ChallengeSummary[] = (await harness.request("/challenges")).challenges;
  expect(listed.length).toBeGreaterThanOrEqual(4);
  expect(listed.find((c) => c.id === definition.id)).toMatchObject({ attempts: 0, met: false, latest: null, workspaceDesignId: null });
  expect((await brief()).debrief).toBeNull();
  await harness.request("/challenges/not-a-challenge", undefined, "GET", 404);

  // Workspace identity is server-assigned and immutable; clients cannot attach a challenge to a design.
  const created = await harness.request(`/challenges/${definition.id}/workspace`, {}, "POST", 201);
  designs.push(created.designId);
  expect((await harness.request(`/challenges/${definition.id}/workspace`, {}, "POST", 200)).designId).toBe(created.designId);
  await harness.request(`/infrastructure/${created.designId}`, { layout: { ...REFERENCE[definition.id]!, layoutVersion: 3 }, challengeId: "cache-matters" }, "PUT");
  expect((await harness.sql.query('SELECT "challengeId" FROM "Infrastructure" WHERE id=$1', [created.designId])).rows[0].challengeId).toBe(definition.id);
  await rejects(harness.sql.query('UPDATE "Infrastructure" SET "challengeId"=NULL WHERE id=$1', [created.designId]), /immutable/);
  const freeform = (await harness.request("/infrastructure", { name: "Freeform design", layout, challengeId: definition.id }, "POST", 201)).createdInfrastructure;
  designs.push(freeform.id);
  expect(freeform.challengeId).toBeNull();

  // Rules, workload and seed cannot be supplied; incomplete predictions never create a run.
  const before = await counts();
  const attempt = (body: unknown, status: number) => harness.request(`/challenges/${definition.id}/attempts`, body, "POST", status);
  await attempt({ infrastructureId: created.designId }, 400);
  await attempt({ infrastructureId: created.designId, prediction, workloadProfile: { targetThroughput: 1, throughputUnit: "per-hour", trafficShape: "steady", payloadSize: "light" } }, 400);
  await attempt({ infrastructureId: created.designId, prediction, criteria: [] }, 400);
  await attempt({ infrastructureId: created.designId, prediction: { answers: { health: "healthy" } } }, 400);
  await attempt({ infrastructureId: created.designId, prediction: { answers: { health: "healthy", busiest: "CDN" } } }, 400);
  await attempt({ infrastructureId: freeform.id, prediction }, 409);
  await harness.request(`/challenges/cache-matters/attempts`, { infrastructureId: created.designId, prediction: { answers: { database: "healthy", busiest: "Database" } } }, "POST", 409);
  const bob = await sessions.create();
  try {
    harness.cookie = bob.cookie;
    await attempt({ infrastructureId: created.designId, prediction }, 404);
    expect((await harness.request(`/challenges/${definition.id}`)).challenge.workspaceDesignId).toBeNull();
  } finally { harness.cookie = cookie; }
  expect(await counts()).toEqual(before);

  const run = (await attempt({ infrastructureId: created.designId, prediction }, 201)).createdDeployment;
  runs.push(run.id);
  const row = await read(run.id);
  expect(row).toMatchObject({ challengeId: definition.id, challengeVersion: definition.version, challengeSpecHash: hash,
    evaluationStopAtSimulatedSeconds: definition.evaluationSeconds, seed: challengeSeed(definition), sourceRunId: null, autoStopAtSimulatedSeconds: null });
  expect(row.workloadProfile).toEqual(definition.workload);
  expect(row.challengePrediction).toEqual(prediction);
  // Recorded by the insert itself, before the worker can start the simulation.
  expect(Math.abs(row.predictionSubmittedAt.getTime() - row.createdAt.getTime())).toBeLessThan(5000);
  await attempt({ infrastructureId: created.designId, prediction }, 409);
  await rejects(harness.sql.query(`UPDATE "Deployment" SET "challengePrediction"='{"answers":{},"reasoning":null}' WHERE id=$1`, [run.id]), /immutable/);
  await rejects(harness.sql.query('UPDATE "Deployment" SET "evaluationStopAtSimulatedSeconds"=999 WHERE id=$1', [run.id]), /immutable/);

  await until(async () => (await read(run.id)).status === "live" || undefined, "challenge attempt live", 30000, 500);
  for (const [path, body] of [["load", { targetLoadFraction: 1.5 }], ["chaos", { type: "crash", resourceId: "vm1" }],
    ["scale-pool", { lbId: "lb", delta: 1 }], ["scale-vertical", { resourceId: "vm1", skuId: "m5.xlarge" }]] as const) {
    await harness.request(`/deployments/${run.id}/${path}`, body, "POST", 409);
  }
  await rejects(harness.sql.query(`INSERT INTO "RunAction" (id,"deploymentId",sequence,kind,parameters) VALUES (gen_random_uuid()::text,$1,999,'load','{"targetLoadFraction":1}')`, [run.id]), /Challenge attempts/);
  await harness.request(`/deployments/${run.id}/speed`, { speed: 60 }, "POST", 202);
  const done = await until(async () => { const r = await read(run.id); return r.status === "torn-down" ? r : undefined; }, "challenge evaluation stop", 40000, 500);
  expect(done.terminalSnapshot.simulatedSeconds).toBe(definition.evaluationSeconds);
  const stops = (await harness.sql.query(`SELECT * FROM "RunAction" WHERE "deploymentId"=$1 AND kind='teardown'`, [run.id])).rows;
  expect(stops).toHaveLength(1);
  expect(stops[0]).toMatchObject({ parameters: { trigger: "challenge-evaluation" }, status: "completed",
    appliedSimulatedSeconds: definition.evaluationSeconds, completedSimulatedSeconds: definition.evaluationSeconds });

  const report: RunReport = (await harness.request(`/deployments/${run.id}/report`)).report;
  expect(report.challenge).toMatchObject({ status: "met", metCount: definition.criteria.length, definitionMatches: true });
  expect(report.challenge?.predictions.map((p) => p.outcome)).toEqual(["matched", "different"]);
  expect(report.run.challenge?.status).toBe("met");
  expect((await brief()).debrief).toEqual(definition.debrief);
  const history = async (kind: string) => (await harness.request(`/deployments/history?kind=${kind}&limit=100`)).runs.map((r: { id: string }) => r.id);
  expect(await history("challenge")).toContain(run.id);
  expect(await history("freeform")).not.toContain(run.id);
  try { harness.cookie = bob.cookie; await harness.request(`/deployments/${run.id}/report`, undefined, "GET", 404); } finally { harness.cookie = cookie; }

  // A rerun of an attempt is an ordinary freeform run with the same captured inputs; compare still works.
  const rerun = (await harness.request(`/deployments/${run.id}/reruns`, { mode: "exact", matchedStop: true }, "POST", 201)).createdDeployment;
  runs.push(rerun.id);
  expect(rerun).toMatchObject({ challengeId: null, challengePrediction: null, evaluationStopAtSimulatedSeconds: null, autoStopAtSimulatedSeconds: definition.evaluationSeconds });
  await until(async () => (await read(rerun.id)).status === "live" || undefined, "attempt rerun live", 30000, 500);
  await harness.request(`/deployments/${rerun.id}/speed`, { speed: 60 }, "POST", 202);
  await until(async () => (await read(rerun.id)).status === "torn-down" || undefined, "attempt rerun stop", 40000, 500);
  expect((await harness.request(`/deployments/compare?a=${run.id}&b=${rerun.id}`)).comparison.headline).toBe("determinism-match");

  // An attempt stopped early is not judged on what it never reached.
  const early = (await attempt({ infrastructureId: created.designId, prediction }, 201)).createdDeployment;
  runs.push(early.id);
  await until(async () => (await read(early.id)).status === "live" || undefined, "early attempt live", 30000, 500);
  await harness.request(`/deployments/${early.id}/teardown`, {}, "POST", 202);
  await until(async () => (await read(early.id)).status === "torn-down" || undefined, "early attempt stop", 30000, 500);
  const earlyReport: RunReport = (await harness.request(`/deployments/${early.id}/report`)).report;
  expect(earlyReport.challenge?.status).toBe("not-evaluated");

  // Deleting the workspace keeps attempts and their derived results.
  await harness.request(`/infrastructure/${created.designId}`, undefined, "DELETE");
  expect((await harness.request(`/deployments/${run.id}/report`)).report.challenge.status).toBe("met");
  expect((await brief()).workspaceDesignId).toBeNull();
  const summary = ((await harness.request("/challenges")).challenges as ChallengeSummary[]).find((c) => c.id === definition.id)!;
  expect(summary).toMatchObject({ attempts: 2, met: true });
  return { attempt: run.id, rerun: rerun.id, early: early.id };
}

/* A resilience attempt end to end: the target is required, the fault cannot be
supplied or spoofed, and the worker applies exactly one durable fault at its
second inside 10x and 60x batches, then judges the attempt at the fault's last second. */
export async function checkResilienceAttempt(harness: LocalHarness, designs: string[], runs: string[]) {
  const { definition, hash } = latestChallenge("lose-an-app-server")!;
  const read = async (id: string) => (await harness.sql.query('SELECT * FROM "Deployment" WHERE id=$1', [id])).rows[0];
  const starter = { ...definition.starter!, layoutVersion: 3 };
  const prediction = { answers: { baseline: "healthy", survivors: "saturated", scale: "no" }, reasoning: null };
  const attempt = (body: unknown, status: number) => harness.request(`/challenges/${definition.id}/attempts`, body, "POST", status);

  const workspace = (await harness.request(`/challenges/${definition.id}/workspace`, {}, "POST", 201)).designId;
  designs.push(workspace);
  expect((await harness.sql.query('SELECT "challengeId","challengeVersion" FROM "Infrastructure" WHERE id=$1', [workspace])).rows[0])
    .toEqual({ challengeId: definition.id, challengeVersion: definition.version });
  const brief: ChallengeBrief = (await harness.request(`/challenges/${definition.id}`)).challenge;
  expect(brief).toMatchObject({ category: "resilience", latestVersion: 1, workspaceDesignId: workspace, earlierWorkspace: null, experiment: definition.experiment });
  await harness.request(`/challenges/${definition.id}?version=9`, undefined, "GET", 404);

  // Without its target the experiment cannot run, and nothing else is substituted.
  const without = { ...starter, resources: starter.resources.filter((r) => r.id !== "app-2"),
    connectionLines: starter.connectionLines.filter((l) => l.sourceId !== "app-2" && l.targetId !== "app-2") };
  const blocked = (await harness.request(`/challenges/${definition.id}/preflight`, { layout: without }, "POST")).preflight;
  expect(blocked).toMatchObject({ valid: false, experiment: { ready: false } });
  await harness.request(`/infrastructure/${workspace}`, { layout: without }, "PUT");
  expect((await attempt({ infrastructureId: workspace, prediction }, 400)).message).toContain("The experiment cannot run");
  await attempt({ infrastructureId: workspace, prediction, experiment: { fault: "crash", atSimulatedSecond: 61 } }, 400);
  await harness.request(`/infrastructure/${workspace}`, { layout: starter }, "PUT");

  const ids: string[] = [];
  for (const speed of [1, 10, 60] as const) {
    const run = (await attempt({ infrastructureId: workspace, prediction }, 201)).createdDeployment;
    runs.push(run.id); ids.push(run.id);
    expect(await read(run.id)).toMatchObject({ challengeVersion: definition.version, challengeSpecHash: hash, evaluationStopAtSimulatedSeconds: 90,
      challengeExperiment: { version: 1, fault: "crash", atSimulatedSecond: 60, durationSimulatedSeconds: 30, targetResourceId: "app-2", targetType: "Virtual Machine" } });
    await until(async () => (await read(run.id)).status === "live" || undefined, "resilience attempt live", 30000, 500);
    // People cannot schedule, spoof or add faults during an attempt.
    await harness.request(`/deployments/${run.id}/chaos`, { type: "crash", resourceId: "app-1", trigger: "challenge-experiment" }, "POST", 400);
    await harness.request(`/deployments/${run.id}/chaos`, { type: "crash", resourceId: "app-1" }, "POST", 409);
    await harness.request(`/deployments/${run.id}/speed`, { speed }, "POST", 202);
    const done = await until(async () => { const r = await read(run.id); return r.status === "torn-down" ? r : undefined; }, `resilience attempt at ${speed}x`, speed === 1 ? 140000 : 60000, 500);
    expect(done.terminalSnapshot.simulatedSeconds).toBe(90);
    const actions = (await harness.sql.query('SELECT * FROM "RunAction" WHERE "deploymentId"=$1 ORDER BY sequence', [run.id])).rows;
    const faults = actions.filter((a) => a.kind === "chaos");
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ parameters: { type: "crash", resourceId: "app-2", trigger: "challenge-experiment" }, status: "completed",
      appliedSimulatedSeconds: 60, completedSimulatedSeconds: 90,
      outcome: { durationSimulatedSeconds: 30, faultEnded: true, observedOverallHealth: "critical", baselineOverallHealth: "healthy" } });
    expect(actions.at(-1)).toMatchObject({ kind: "teardown", parameters: { trigger: "challenge-evaluation" }, appliedSimulatedSeconds: 90 });
    const report: RunReport = (await harness.request(`/deployments/${run.id}/report`)).report;
    expect(report.experimentTrace).toMatchObject({ status: "complete", expectedStart: 30, expectedEnd: 90, sampleCount: 61 });
    expect(report.challenge).toMatchObject({ status: "not-met", definitionMatches: true,
      experiment: { state: "ended", appliedSimulatedSeconds: 60, endedSimulatedSeconds: 90, baselineOverallHealth: "healthy", targetHealthAtEvaluation: "failed" } });
    expect(report.challenge?.predictions.map((p) => p.outcome)).toEqual(["matched", "matched", "matched"]);
    expect(report.actions.find((a) => a.kind === "chaos")?.parameters).toMatchObject({ trigger: "challenge-experiment" });
  }
  const comparison = (await harness.request(`/deployments/compare?a=${ids[0]}&b=${ids[1]}`)).comparison;
  // Identical experiment conditions and conduct make a matched pair. The fault is an
  // affecting action, so the deterministic-state check (no affecting actions) does not apply.
  expect(comparison).toMatchObject({ challengeConditions: "same", headline: "matched-pair" });
  expect(comparison.conduct.code).toBe("same");
  const listed = ((await harness.request("/challenges")).challenges as ChallengeSummary[]).find((c) => c.id === definition.id)!;
  expect(listed).toMatchObject({ category: "resilience", attempts: 3, workspaceDesignId: workspace });
  return ids;
}
