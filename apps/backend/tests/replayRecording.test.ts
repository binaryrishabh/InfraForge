import { expect, mock, test } from "bun:test";
import { actionDto } from "../actions/contract";
import type { RunAction as StoredAction } from "../lib/generated/prisma/client";

// An in-memory transaction: writes become visible only when the callback finishes; a throw discards them.
const committed: Array<{ kind: string; parameters: Record<string, unknown> }> = [];
let failSecondInsert = true;
mock.module("../lib/prisma", () => ({ prisma: { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
  const pending: typeof committed = [];
  const tx = { $queryRaw: async () => [], deployment: { update: async () => ({ actionSequence: committed.length + pending.length + 1 }) },
    runAction: { count: async ({where}: {where: {kind: {in: string[]}}}) => committed.filter(row => where.kind.in.includes(row.kind)).length, create: async ({ data }: { data: (typeof committed)[number] }) => {
      if (failSecondInsert && pending.length === 1) { failSecondInsert = false; throw new Error("transient transaction failure"); }
      pending.push(data); return data;
    } } };
  const result = await fn(tx); committed.push(...pending); return result;
} } }));
const { recordReplayActions } = await import("../simulator/replay");

test("a rolled-back replay transaction records every submitted action on retry, in order", async () => {
  const load = (targetLoadFraction: number) => ({ atSecond: 5, request: { kind: "load" as const, parameters: { targetLoadFraction } } });
  const instance = { model2: { simulatedSeconds: 5 }, replay: { actions: [load(0.5), load(1.5)], next: 0 } } as never;
  await expect(recordReplayActions("replay-test", instance)).rejects.toThrow("transient transaction failure");
  expect(committed).toEqual([]);
  expect((instance as { replay: { next: number } }).replay.next).toBe(0);
  await recordReplayActions("replay-test", instance);
  expect(committed.map((a) => a.parameters.targetLoadFraction)).toEqual([0.5, 1.5]);
});

test("a Model 2 replica change, which names no replica, is a readable completed action", () => {
  const at = new Date();
  const row = { id: "a", deploymentId: "d", sequence: 1, kind: "pool-scale", parameters: { lbId: "lb", delta: 1 }, status: "completed",
    requestedAt: at, appliedAt: at, completedAt: at, appliedSimulatedSeconds: 3, completedSimulatedSeconds: 6,
    outcome: { delta: 1, previousReplicaCount: 2, finalReplicaCount: 3 }, failureReason: null } as unknown as StoredAction;
  expect(actionDto(row)).toMatchObject({ kind: "pool-scale", status: "completed", outcome: { finalReplicaCount: 3 } });
});

test("a rolled-back intervention replay retries once in sequence and a lost reply never duplicates it", async () => {
  committed.length = 0; failSecondInsert = true;
  const request = {kind: "intervention", parameters: {interventionId: "session-capacity", revision: 1, target: {resourceId: "db"}, parameters: {sessions: 0, duration: 2}}};
  const instance = {model2: {simulatedSeconds: 5}, replay: {next: 0, actions: [{atSecond: 5, request}, {atSecond: 5, request: {kind: "load", parameters: {targetLoadFraction: 1.5}}}]}} as never;
  await expect(recordReplayActions("intervention-retry", instance)).rejects.toThrow("transient transaction failure");
  expect(committed).toEqual([]);
  await recordReplayActions("intervention-retry", instance);
  expect(committed.map(row => row.kind)).toEqual(["intervention", "load"]);
  expect(committed[0]!.parameters).toEqual(request.parameters);
  (instance as {replay: {next: number}}).replay.next = 0;
  await recordReplayActions("intervention-retry", instance);
  expect(committed).toHaveLength(2);
  expect((instance as {replay: {next: number}}).replay.next).toBe(2);
});
