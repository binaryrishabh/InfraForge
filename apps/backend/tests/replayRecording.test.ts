import { expect, mock, test } from "bun:test";
import { actionDto } from "../actions/contract";
import type { RunAction as StoredAction } from "../lib/generated/prisma/client";

// An in-memory transaction: writes become visible only when the callback finishes; a throw discards them.
const committed: Array<{ parameters: { targetLoadFraction: number } }> = [];
let failSecondInsert = true;
mock.module("../lib/prisma", () => ({ prisma: { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
  const pending: typeof committed = [];
  const tx = { $queryRaw: async () => [], deployment: { update: async () => ({ actionSequence: committed.length + pending.length + 1 }) },
    runAction: { count: async () => committed.length, create: async ({ data }: { data: (typeof committed)[number] }) => {
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
