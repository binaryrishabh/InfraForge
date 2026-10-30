import { expect, mock, test } from "bun:test";
import type { RunAction } from "../lib/generated/prisma/client";
import type { SimulationInstance } from "../simulator/instance";
import { boundRetriesDuringSlowdownV1 as d } from "../challenges/definitions/bound-retries-during-slowdown/v1";
import { REFERENCE, answers, attemptRow } from "./challengeHarness";
import { readRunInputs } from "../deployments/runInputs";
import { recordedScenario } from "../challenges/scenario";
import { createModel2Engine } from "../simulator/model2Engine";
import { captureSnapshot } from "../simulator/snapshot";
import { buildRunReport, type StoredRun } from "../reports/report";
import { learningAttempt } from "../challenges/history";

// Run separately from other persistence mocks. The claim commits to the fake store
// before its reply is lost; all engine application and report judging are real.
const rows: RunAction[] = [];
let loseClaimReply = true, loseTerminalReply = false, sequence = 0;
let deployment: StoredRun & {actionSequence: number};
const notifications: Array<{status?: string; publishType?: string}> = [];
type Where = {id?: string | {not: string}; deploymentId?: string; status?: string | {in: string[]}; scenarioStepId?: {not: null}};
const matches = (row: RunAction, where: Where) => (!where.id || (typeof where.id === "string" ? row.id === where.id : row.id !== where.id.not)) &&
  (!where.deploymentId || row.deploymentId === where.deploymentId) &&
  (!where.status || (typeof where.status === "string" ? row.status === where.status : where.status.in.includes(row.status))) &&
  (!where.scenarioStepId || row.scenarioStepId !== null);
const database = {
  $queryRaw: async () => [],
  deployment: {
    findUniqueOrThrow: async () => structuredClone(deployment),
    update: async ({data}: {data: Partial<StoredRun> & {actionSequence?: {increment: number}}}) => {
      const {actionSequence, ...rest} = data;
      Object.assign(deployment, rest);
      if (actionSequence) deployment.actionSequence = ++sequence;
      return structuredClone(deployment);
    },
  },
  runAction: {
    findUnique: async ({where}: {where: {deploymentId_scenarioStepId: {deploymentId: string; scenarioStepId: string}}}) =>
      rows.find(row => row.deploymentId === where.deploymentId_scenarioStepId.deploymentId && row.scenarioStepId === where.deploymentId_scenarioStepId.scenarioStepId) ?? null,
    create: async ({data}: {data: Pick<RunAction, "deploymentId" | "sequence" | "scenarioStepId" | "kind" | "parameters">}) => {
      const row: RunAction = {...data, id: `action-${data.sequence}`, status: "requested", requestedAt: new Date(), appliedAt: null,
        completedAt: null, appliedSimulatedSeconds: null, completedSimulatedSeconds: null, outcome: null, failureReason: null};
      rows.push(row); return row;
    },
    findMany: async ({where}: {where: Where}) => rows.filter(row => matches(row, where)).map(row => structuredClone(row)),
    findFirst: async ({where}: {where: Where}) => structuredClone(rows.find(row => matches(row, where)) ?? null),
    findUniqueOrThrow: async ({where}: {where: Where}) => {
      const row = rows.find(row => matches(row, where)); if (!row) throw Error("Missing row"); return structuredClone(row);
    },
    update: async ({where, data}: {where: Where; data: Partial<RunAction>}) => {
      const row = rows.find(row => matches(row, where)); if (!row) throw Error("Missing row");
      Object.assign(row, data); return structuredClone(row);
    },
    updateMany: async ({where, data}: {where: Where; data: Partial<RunAction>}) => {
      const matched = rows.filter(row => matches(row, where));
      matched.forEach(row => Object.assign(row, data));
      if (matched.length && data.status === "applying" && loseClaimReply) { loseClaimReply = false; throw Error("claim committed but reply lost"); }
      return {count: matched.length};
    },
  },
};
mock.module("../lib/prisma", () => ({prisma: {...database, $transaction: async (fn: (tx: typeof database) => Promise<unknown>) => {
  const result = await fn(database);
  if (loseTerminalReply && deployment.status !== "live") { loseTerminalReply = false; throw Error("terminal committed but reply lost"); }
  return result;
}}}));
mock.module("../infra/pubsub", () => ({publishSimulationSnapshot: async () => {}}));
mock.module("../infra/redis", () => ({redis: {publish: async (_channel: string, payload: string) => { notifications.push(JSON.parse(payload)); }}}));
const {establishScenario} = await import("../simulator/scenario");
const {processRunActions} = await import("../simulator/actions");
const {finishTeardown} = await import("../simulator/terminal");
const {flushAcknowledgement} = await import("../simulator/actionAcknowledgement");

test("a lost committed scenario claim ends failed and unscored through the real terminal writer", async () => {
  const design = REFERENCE[d.id]!, prediction = answers(d, {"overall-health": "saturated"});
  const row = attemptRow(d, design, prediction, {skipExperiment: true}), input = readRunInputs(row.runInputs);
  const plan = recordedScenario(d, input)!;
  deployment = {...row, status: "live", runtimeActive: true, actionSequence: 0};
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
  const teardown = await database.runAction.create({data: {deploymentId: row.id, sequence: ++sequence, scenarioStepId: null, kind: "teardown", parameters: {}}});
  teardown.status = "applying";
  let removed = 0;
  loseTerminalReply = true;
  await expect(finishTeardown(row.id, instance, teardown, () => { removed++; })).rejects.toThrow("terminal committed but reply lost");
  expect(deployment.status).toBe("failed");
  expect(deployment.runtimeActive).toBe(false);
  const terminal = structuredClone(deployment.terminalSnapshot);
  await flushAcknowledgement(instance);
  expect(deployment.terminalSnapshot).toEqual(terminal);
  expect(rows).toHaveLength(2);
  expect(rows.filter(action => action.scenarioStepId)).toHaveLength(1);
  const report = buildRunReport({...deployment, actions: rows, actionCount: rows.length});
  expect(report.terminal?.simulatedSeconds).toBe(5);
  expect(report.challenge).toMatchObject({status: "not-evaluated", metCount: 0});
  expect(report.challenge?.criteria.every(c => c.detail.includes("unscored"))).toBe(true);
  expect(learningAttempt({...deployment, actions: rows}).canRetry).toBe(true);
  expect(removed).toBe(1);
  expect(notifications.at(-1)).toMatchObject({status: "failed", publishType: "deployment-failed"});
  // A new attempt captures the same immutable conditions and applies one step.
  const retry = attemptRow(d, design, prediction);
  expect(retry.id).not.toBe(row.id);
  expect(retry.runInputs).toEqual(row.runInputs);
  expect(retry.actions).toHaveLength(1);
  expect(buildRunReport(retry).challenge?.status).toBe("met");
});

test("terminal capture preserves normal scenario completion and ordinary action failures", async () => {
  for (const scenario of [true, false]) {
    const row = attemptRow(d, REFERENCE[d.id]!, answers(d, {"overall-health": "saturated"}));
    rows.length = 0; sequence = 1;
    rows.push(...structuredClone(row.actions!));
    if (!scenario) Object.assign(rows[0]!, {scenarioStepId: null, status: "failed", failureReason: "Ordinary action failed"});
    deployment = {...row, status: "live", runtimeActive: true, actionSequence: sequence,
      ...(scenario ? {} : {challengeId: null, challengeScenario: null})};
    const input = readRunInputs(row.runInputs);
    const instance: SimulationInstance = {model2: createModel2Engine(input, 5), tickCount: 5, speed: 1, pendingLogs: [], lastCheckpointAt: 0,
      accumulatedCostUsd: 0, topology: input, topologyRevision: 0, actions: new Map(), acknowledge: null,
      metricsComputedAt: null, metricsTopologyRevision: 0};
    const teardown = await database.runAction.create({data: {deploymentId: row.id, sequence: ++sequence, scenarioStepId: null, kind: "teardown", parameters: {}}});
    teardown.status = "applying";
    await finishTeardown(row.id, instance, teardown, () => {}, row.terminalSnapshot as ReturnType<typeof captureSnapshot>);
    expect(deployment.status).toBe("torn-down");
    expect(notifications.at(-1)).toMatchObject({status: "torn-down", publishType: "deployment-torn-down"});
    if (scenario) expect(buildRunReport({...deployment, actions: rows}).challenge?.status).toBe("met");
  }
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
