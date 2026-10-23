import { expect, test } from "bun:test";
import { reconcileSubmissionQueue, queueOperations, pruneVerificationJobs, verificationJobOptions, recordQueueEvent } from "../firstStack/queueOperations";
import { submissionStorage, submissionStorageLimits, requireSubmissionStorage } from "../firstStack/submissionStorage";
import { requireOfflineRecovery } from "../firstStack/recoveryOperations";
import { firstStackOperations } from "../release/firstStackOperations";

function recoveryPool(claimed = true) {
  const calls: { sql: string; values: any[] }[] = [];
  const db = { release() {}, async query(sql: string, values: any[] = []) {
    calls.push({ sql, values });
    return { rows: [], rowCount: sql.includes("RETURNING") ? Number(claimed) : 1 };
  } };
  return { calls, pool: { connect: async () => db, query: async (sql: string) => {
    calls.push({ sql, values: [] });
    return { rows: sql.includes("UNION ALL") ? [{ id: "run", operation: "submission" }, { id: "replay", operation: "replay" }] : [] };
  } } as any };
}

test("lost, failed and completed delivery quarantines without redispatch or a result", async () => {
  for (const state of [null, "unknown", "failed", "completed"]) {
    const { pool, calls } = recoveryPool();
    const ids: string[] = [];
    await reconcileSubmissionQueue(pool, { getJob: async (id: string) => { ids.push(id); return state === null ? undefined : { getState: async () => state }; } } as any, "c".repeat(64));
    expect(ids).toEqual(["run", "replay-replay"]);
    expect(calls.filter(c => c.sql.includes("status='running'")).length).toBe(2);
    expect(calls.filter(c => c.sql.includes("SET status='recovery'")).length).toBe(2);
    expect(calls.filter(c => c.sql === "COMMIT").length).toBe(2);
    expect(calls.filter(c => c.sql.includes("INSERT INTO")).length).toBe(2);
    expect(calls.some(c => c.sql.includes("FirstStackResult"))).toBe(false);
    expect(calls.filter(c => c.sql.includes("INSERT INTO")).every(c => c.sql.includes("FirstStackQueueEvent"))).toBe(true);
    expect(calls.find(c => c.sql.includes("token=$2"))!.values[1]).toMatch(/^[a-f0-9-]{36}$/);
  }
});

test("live waiting, active and delayed jobs never enter recovery; Redis errors remain errors", async () => {
  for (const state of ["waiting", "active", "delayed", "waiting-children", "prioritized"]) {
    const { pool, calls } = recoveryPool();
    await reconcileSubmissionQueue(pool, { getJob: async () => ({ getState: async () => state }) } as any, "c".repeat(64));
    expect(calls.some(c => c.sql.includes("UPDATE"))).toBe(false);
  }
  const { pool, calls } = recoveryPool();
  await expect(reconcileSubmissionQueue(pool, { getJob: async () => { throw Error("Redis unavailable"); } } as any, "c".repeat(64))).rejects.toThrow("Redis unavailable");
  expect(calls.some(c => c.sql.includes("UPDATE"))).toBe(false);
});

test("a worker that already claimed wins the reconciliation race", async () => {
  const { pool, calls } = recoveryPool(false);
  await reconcileSubmissionQueue(pool, { getJob: async () => undefined } as any, "c".repeat(64));
  expect(calls.some(c => c.sql.includes("SET status='recovery'"))).toBe(false);
  expect(calls.some(c => c.sql.includes("INSERT INTO"))).toBe(false);
});

test("Redis age and count pruning covers legacy jobs without touching active work", async () => {
  const cleaned: any[] = [], listed: any[] = [], removed: string[] = [];
  await pruneVerificationJobs({ clean: async (...args: any[]) => { cleaned.push(args); }, getJobs: async (...args: any[]) => {
    listed.push(args); return [{ remove: async () => { removed.push(args[0][0]); } }];
  } } as any);
  expect(verificationJobOptions.attempts).toBe(1);
  expect(verificationJobOptions.removeOnComplete).toEqual({ age: 86400, count: 128 });
  expect(verificationJobOptions.removeOnFail).toEqual({ age: 2592000, count: 256 });
  expect(cleaned).toEqual([[86400000, 256, "completed"], [2592000000, 256, "failed"]]);
  expect(listed).toEqual([[["completed"], 128, 383, false], [["failed"], 256, 511, false]]);
  expect(removed).toEqual(["completed", "failed"]);
});

test("operator queue metrics are numeric and exclude job payloads, errors and hidden audit", async () => {
  const row = { recovery: 3, oldestQueuedMs: "1200", deliveryLagMs: null, maxDeliveryLag30dMs: "500", failed30d: 2, stalled30d: 1, reconciled30d: 3, hidden: "secret" };
  const stats = await queueOperations({ query: async () => ({ rows: [row] }) } as any,
    { getJobCounts: async () => ({ waiting: 2, active: 1, failed: 2, completed: 3, delayed: 0, hidden: "secret" }) } as any);
  expect(stats).toEqual({ redis: { waiting: 2, active: 1, failed: 2, completed: 3, delayed: 0 }, recovery: 3,
    oldestQueuedMs: 1200, deliveryLagMs: null, maxDeliveryLag30dMs: 500, failed30d: 2, stalled30d: 1, reconciled30d: 3 });
  await expect(queueOperations({ query: async () => ({ rows: [] }) } as any,
    { getJobCounts: async () => ({}) } as any)).rejects.toThrow("unavailable");
  const events: unknown[] = [];
  for (const kind of ["failed", "stalled"] as const) await recordQueueEvent({ query: async (_sql: string, values: unknown[]) => { events.push(values); } } as any, kind);
  expect(events).toEqual([["failed"], ["stalled"]]);
});

test("storage charges serial cuts, full result audit, retained inputs, replays and physical allocation", async () => {
  const read = (physical: string) => submissionStorage({ query: async () => ({ rows: [{ recorded: "500", live: "100", runs: "200", cuts: "300", results: "400", replays: "50", physical }] }) } as any);
  expect(await read("500")).toMatchObject({ historyBytes: 950, chargedBytes: 1050, cutBytes: 300, resultBytes: 400 });
  expect(await read("1500")).toMatchObject({ physicalBytes: 1500, chargedBytes: 1600 });
  for (const bad of [null, "unknown", "-1"]) await expect(submissionStorage({ query: async () => ({ rows: [{ recorded: "0", live: bad, runs: "0", cuts: "0", results: "0", replays: "0", physical: "0" }] }) } as any)).rejects.toThrow("unavailable");
});

test("live reservations and finite history capacity refuse independently, including private history", async () => {
  const usage = await submissionStorage({ query: async () => ({ rows: [{ recorded: "500", live: "0", runs: "100", cuts: "0", results: "0", replays: "0", physical: "100" }] }) } as any);
  expect(requireSubmissionStorage(usage, 100, true)).toBe(true);
  expect(requireSubmissionStorage({ ...usage, liveReservedBytes: submissionStorageLimits.liveBytes }, 1, true)).toBe(false);
  expect(requireSubmissionStorage({ ...usage, liveReservedBytes: submissionStorageLimits.liveBytes }, 1, false)).toBe(true);
  for (const verifying of [false, true]) expect(requireSubmissionStorage({ ...usage, chargedBytes: submissionStorageLimits.historyBytes }, 1, verifying)).toBe(false);
});

test("offline recovery refuses either a live lifecycle or executor and unknown lock ownership", async () => {
  for (const blocked of [12, 10]) {
    await expect(requireOfflineRecovery({ query: async (_sql: string, values: number[]) => ({ rows: [{ held: values[0] !== blocked }] }) } as any)).rejects.toThrow("Stop verifier");
  }
  await expect(requireOfflineRecovery({ query: async () => ({ rows: [] }) } as any)).rejects.toThrow("Stop verifier");
  const locks: number[] = [];
  await requireOfflineRecovery({ query: async (_sql: string, values: number[]) => { locks.push(values[0]!); return { rows: [{ held: true }] }; } } as any);
  expect(locks).toEqual([12, 10]);
});

test("packaged recovery command refuses unsupported operations before database or file access", async () => {
  const pool = { query: async () => { throw Error("Unexpected database access"); } } as any;
  for (const args of [[], ["verify", "id", "review.json"], ["close-submission", "invalid", "review.json"]]) {
    await expect(firstStackOperations(args, pool)).rejects.toThrow();
  }
});
