import { expect, mock, test } from "bun:test";
import type { RunAction } from "../lib/generated/prisma/client";
import type { SimulationInstance } from "../simulator/instance";
import { boundRetriesDuringSlowdownV1 as d } from "../challenges/definitions/bound-retries-during-slowdown/v1";
import { REFERENCE, answers, attemptRow } from "./challengeHarness";
import { readRunInputs } from "../deployments/runInputs";
import { recordedScenario } from "../challenges/scenario";
import { createModel2Engine } from "../simulator/model2Engine";
import { captureSnapshot } from "../simulator/snapshot";
import { buildRunReport } from "../reports/report";

// Run separately from other persistence mocks. The claim commits to the fake store
// before its reply is lost; all engine application and report judging are real.
const rows: RunAction[] = [];
let loseClaimReply = true, sequence = 0;
const database = {
  $queryRaw: async () => [],
  deployment: {
    findUniqueOrThrow: async () => ({status: "live", runtimeActive: true}),
    update: async () => ({actionSequence: ++sequence}),
  },
  runAction: {
    findUnique: async ({where}: {where: {deploymentId_scenarioStepId: {deploymentId: string; scenarioStepId: string}}}) =>
      rows.find(row => row.deploymentId === where.deploymentId_scenarioStepId.deploymentId && row.scenarioStepId === where.deploymentId_scenarioStepId.scenarioStepId) ?? null,
    create: async ({data}: {data: Pick<RunAction, "deploymentId" | "sequence" | "scenarioStepId" | "kind" | "parameters">}) => {
      const row: RunAction = {...data, id: `action-${data.sequence}`, status: "requested", requestedAt: new Date(), appliedAt: null,
        completedAt: null, appliedSimulatedSeconds: null, completedSimulatedSeconds: null, outcome: null, failureReason: null};
      rows.push(row); return row;
    },
    findMany: async () => rows.filter(row => ["requested", "applying"].includes(row.status)).map(row => structuredClone(row)),
    updateMany: async ({where, data}: {where: {id: string; status: string | {in: string[]}}; data: Partial<RunAction>}) => {
      const row = rows.find(row => row.id === where.id && (typeof where.status === "string" ? row.status === where.status : where.status.in.includes(row.status)));
      if (!row) return {count: 0};
      Object.assign(row, data);
      if (data.status === "applying" && loseClaimReply) { loseClaimReply = false; throw Error("claim committed but reply lost"); }
      return {count: 1};
    },
  },
};
mock.module("../lib/prisma", () => ({prisma: {...database, $transaction: async (fn: (tx: typeof database) => Promise<unknown>) => fn(database)}}));
mock.module("../infra/pubsub", () => ({publishSimulationSnapshot: async () => {}}));
mock.module("../infra/redis", () => ({redis: {publish: async () => {}}}));
const {establishScenario} = await import("../simulator/scenario");
const {processRunActions} = await import("../simulator/actions");

test("a lost committed scenario claim ends unscored without duplicate steps and a fresh attempt passes", async () => {
  const design = REFERENCE[d.id]!, prediction = answers(d, {"overall-health": "saturated"});
  const row = attemptRow(d, design, prediction, {skipExperiment: true}), input = readRunInputs(row.runInputs);
  const plan = recordedScenario(d, input)!;
  const instance: SimulationInstance = {model2: createModel2Engine(input, 5), tickCount: 0, speed: 3600, pendingLogs: [], lastCheckpointAt: 0,
    accumulatedCostUsd: 0, topology: input, topologyRevision: 0, actions: new Map(), acknowledge: null, metricsComputedAt: null,
    metricsTopologyRevision: 0, autoStopAtSimulatedSeconds: 5, scenario: {plan, next: 0, pending: new Set()}};
  instance.model2.advance(); instance.model2.advance();
  await establishScenario(row.id, instance);
  await expect(processRunActions(row.id, instance, () => {})).rejects.toThrow("claim committed but reply lost");
  expect(rows[0]!.status).toBe("applying");
  expect(instance.model2.actions).toHaveLength(0);
  for (let retry = 0; retry < 3; retry++) {
    await establishScenario(row.id, instance);
    await processRunActions(row.id, instance, () => {});
  }
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({status: "failed", appliedAt: null, appliedSimulatedSeconds: null});
  expect(instance.model2.actions).toHaveLength(0);
  expect(instance.scenario!.pending.size).toBe(0);
  while (instance.model2.simulatedSeconds < 5) instance.model2.advance();
  const report = buildRunReport({...row, terminalSnapshot: captureSnapshot(row.id, instance, "terminal"), actions: rows, actionCount: rows.length});
  expect(report.terminal?.simulatedSeconds).toBe(5);
  expect(report.challenge).toMatchObject({status: "not-evaluated", metCount: 0});
  expect(report.challenge?.criteria.every(c => c.detail.includes("unscored"))).toBe(true);
  // A new attempt captures the same immutable conditions and applies one step.
  const retry = attemptRow(d, design, prediction);
  expect(retry.id).not.toBe(row.id);
  expect(retry.runInputs).toEqual(row.runInputs);
  expect(retry.actions).toHaveLength(1);
  expect(buildRunReport(retry).challenge?.status).toBe("met");
});

test("restart retirement leaves even completed-step evidence unscored without a terminal measurement", () => {
  const row = attemptRow(d, REFERENCE[d.id]!, answers(d, {"overall-health": "saturated"}));
  expect(buildRunReport(row).challenge?.status).toBe("met");
  for (const applied of [false, true]) {
    const interrupted = structuredClone(row);
    interrupted.status = "failed"; interrupted.runtimeActive = false; interrupted.terminalSnapshot = null;
    interrupted.timeline = [{timestamp: new Date().toISOString(), event: "Simulation Interrupted", message: "Worker restart interrupted this replay."}];
    if (!applied) Object.assign(interrupted.actions![0]!, {status: "failed", appliedAt: null, appliedSimulatedSeconds: null,
      completedAt: new Date(), completedSimulatedSeconds: null, outcome: null, failureReason: "Worker restart interrupted this action."});
    const report = buildRunReport(interrupted);
    expect(report.run.status).toBe("failed");
    expect(report.challenge?.status).toBe("not-evaluated");
    expect(report.challenge?.criteria.some(c => c.id === "latency" && c.status === "not-evaluated")).toBe(true);
  }
});
