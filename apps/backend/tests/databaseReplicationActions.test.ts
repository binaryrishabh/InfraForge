import { expect, mock, test } from "bun:test";
import type { RunAction } from "../lib/generated/prisma/client";
import type { SimulationInstance } from "../simulator/instance";
import { createModel2Engine } from "../simulator/model2Engine";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { databaseLayout, databaseWorkload } from "./databaseReplication.fixture";
import { actionDto } from "../actions/contract";

// Isolated persistence harness; request validation, worker application, receipts and replay use production code.
const rows: RunAction[] = [];
const topology = databaseLayout();
const deployment = {id: "run", ownerId: "owner", status: "live", runtimeActive: true, challengeId: null as string | null, browserSubmission: null, liveTopology: topology, actionSequence: 0};
type Where = {id?: string; deploymentId?: string; status?: string | {in: string[]}; kind?: {in: string[]}; deployment?: {status: string; runtimeActive: boolean}};
const matches = (row: RunAction, w: Where) => (!w.id || row.id === w.id) && (!w.deploymentId || row.deploymentId === w.deploymentId) && (!w.status || (typeof w.status === "string" ? row.status === w.status : w.status.in.includes(row.status))) && (!w.kind || w.kind.in.includes(row.kind)) && (!w.deployment || deployment.status === w.deployment.status && deployment.runtimeActive === w.deployment.runtimeActive);
let loseCompletionReply = false;
const database = {
  $queryRaw: async () => [],
  deployment: {
    findUnique: async ({where}: {where: {id: string; ownerId: string}}) => where.id === deployment.id && where.ownerId === deployment.ownerId ? {...deployment} : null,
    update: async () => ({...deployment, actionSequence: ++deployment.actionSequence}),
  },
  runAction: {
    findMany: async ({where}: {where: Where}) => rows.filter(r => matches(r, where)).map(r => structuredClone(r)),
    count: async ({where}: {where: Where}) => rows.filter(r => matches(r, where)).length,
    create: async ({data}: {data: Pick<RunAction, "deploymentId" | "sequence" | "kind" | "parameters">}) => {
      const row: RunAction = {...data, id: `row-${data.sequence}`, scenarioStepId: null, status: "requested", requestedAt: new Date(), appliedAt: null, completedAt: null, appliedSimulatedSeconds: null, completedSimulatedSeconds: null, outcome: null, failureReason: null};
      rows.push(row); return structuredClone(row);
    },
    findUnique: async ({where}: {where: Where}) => structuredClone(rows.find(r => matches(r, where)) ?? null),
    updateMany: async ({where, data}: {where: Where; data: Partial<RunAction>}) => {
      const selected = rows.filter(r => matches(r, where)); selected.forEach(r => Object.assign(r, data));
      if (selected.length && data.status === "completed" && loseCompletionReply) { loseCompletionReply = false; throw Error("completion committed but reply lost"); }
      return {count: selected.length};
    },
  },
};
mock.module("../lib/prisma", () => ({prisma: {...database, $transaction: async (fn: (tx: typeof database) => Promise<unknown>) => fn(database)}}));
mock.module("../infra/pubsub", () => ({publishSimulationSnapshot: async () => {}}));
mock.module("../infra/redis", () => ({redis: {publish: async () => {}}}));
const {requestRunAction} = await import("../actions/persistence");
const {processRunActions, recordActionCompletions} = await import("../simulator/actions");
const {recordReplayActions} = await import("../simulator/replay");
const {flushAcknowledgement} = await import("../simulator/actionAcknowledgement");
const request = {kind: "intervention" as const, parameters: {interventionId: "db-promote-replica", revision: 1, target: {resourceId: "db"}, parameters: {}}};
const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(topology, databaseWorkload, "durable-db-promote-replica"))));
const instance = (): SimulationInstance => ({model2: createModel2Engine(input, 8), tickCount: 0, speed: 1, pendingLogs: [], lastCheckpointAt: 0, accumulatedCostUsd: 0, topology, topologyRevision: 0, actions: new Map(), acknowledge: null, metricsComputedAt: null, metricsTopologyRevision: 0});

test("Database promotion durable request scopes the owner and run, refuses malformed input, and completes once after a lost reply", async () => {
  for (const [id, owner] of [["other-run", "owner"], ["run", "other-owner"]]) await expect(requestRunAction(id!, owner!, request)).rejects.toThrow("not found");
  await expect(requestRunAction("run", "owner", {...request, parameters: {...request.parameters, parameters: {force: true}}})).rejects.toThrow("Invalid");
  await expect(requestRunAction("run", "owner", {...request, parameters: {...request.parameters, target: {resourceId: "absent"}}})).rejects.toThrow("absent");
  deployment.challengeId = "challenge";
  await expect(requestRunAction("run", "owner", request)).rejects.toThrow("fixed conditions"); deployment.challengeId = null;
  deployment.status = "completed";
  await expect(requestRunAction("run", "owner", request)).rejects.toThrow("live run"); deployment.status = "live";
  expect(rows).toHaveLength(0);
  const dto = await requestRunAction("run", "owner", request);
  expect(dto).toMatchObject({status: "requested", kind: "intervention", parameters: request.parameters, sequence: 1});
  const run = instance(); run.model2.advance();
  expect(run.model2.evidence().data.databases[0]!.databaseReplication!.primaryCommittedWrites).toBeGreaterThan(0);
  await processRunActions("run", run, () => {});
  expect(rows[0]).toMatchObject({status: "running", appliedSimulatedSeconds: 1, outcome: {intervention: {atUs: 1_000_001, endUs: null}}});
  await processRunActions("run", run, () => {}); expect(run.model2.actions).toHaveLength(1);
  run.model2.advance(); loseCompletionReply = true;
  await expect(recordActionCompletions(run)).rejects.toThrow("completion committed but reply lost");
  await flushAcknowledgement(run); await processRunActions("run", run, () => {});
  const completed = actionDto(rows[0]!);
  expect(completed).toMatchObject({status: "completed", completedSimulatedSeconds: 2, outcome: {interventionEnded: true, intervention: {atUs: 1_000_001, endUs: null}}});
  expect(run.actions.size).toBe(0); expect(run.model2.actions).toHaveLength(1);
  expect(run.model2.evidence().data.databases[0]!.databaseReplication).toMatchObject({ currentWriter: "replica", promotionCount: 1 });
  expect(run.model2.evidence().data.databases[0]!.databaseReplication!.lostOperations).toBeGreaterThan(0);
  expect(() => run.model2.apply(request)).toThrow("already promoted");
  expect(actionDto(structuredClone(rows[0]!))).toEqual(completed);
  const replay = instance(); replay.replay = {next: 0, actions: [{atSecond: 1, request}]};
  replay.model2.advance();
  rows.length = 0; deployment.actionSequence = 0;
  await recordReplayActions("run", replay); replay.replay.next = 0;
  await recordReplayActions("run", replay); expect(rows).toHaveLength(1);
  await processRunActions("run", replay, () => {}); replay.model2.advance(); await recordActionCompletions(replay);
  expect(replay.model2.evidence()).toEqual(run.model2.evidence());
  expect(actionDto(rows[0]!)).toMatchObject({status: "completed", outcome: completed.outcome});
  const evidence = JSON.stringify(replay.model2.evidence());
  await processRunActions("run", replay, () => {}); await recordReplayActions("run", replay);
  expect(rows).toHaveLength(1); expect(JSON.stringify(replay.model2.evidence())).toBe(evidence);
});
