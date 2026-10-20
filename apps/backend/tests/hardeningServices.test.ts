import { expect, test } from "bun:test";
import { Pool } from "pg";
import Redis from "ioredis";
import { Queue, Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { databasePoolPolicy, redisPolicy } from "../utils/connectionPolicy";
import { WorkerOwnership } from "../infra/workerOwnership";
import { isRetiredDeployment } from "../utils/deploymentJobPolicy";

// Only the owned Docker network supplies these DNS names. No source/production
// URL or port is accepted from the caller.
const fixture = test.skipIf(process.env.HARDENING_SERVICES !== "owned-local");
const databaseUrl = "postgresql://postgres@hardening-postgres:5432/infraforge_hardening";
const pool = () => new Pool({ ...databasePoolPolicy, connectionString: databaseUrl });
async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (await check()) return; await Bun.sleep(25); }
  throw new Error("Owned fixture did not settle");
}

fixture("slow PostgreSQL statement is cancelled on the server and the same pool recovers", async () => {
  const db = pool();
  db.on("error", () => {});
  try {
    await expect(db.query("SELECT pg_sleep(30)")).rejects.toMatchObject({ code: "57014" });
    expect((await db.query("SELECT 1 AS healthy")).rows[0].healthy).toBe(1);
    expect(db.waitingCount).toBe(0);
  } finally { await db.end(); }
}, 25000);

fixture("retained queue jobs deduplicate delivery and terminal guards survive retention cleanup", async () => {
  const name = `hardening-${randomUUID()}`;
  const producer = new Redis({ host: "hardening-redis", ...redisPolicy() });
  const consumer = new Redis({ host: "hardening-redis", ...redisPolicy(true) });
  producer.on("error", () => {}); consumer.on("error", () => {});
  const queue = new Queue(name, { connection: producer, defaultJobOptions: { removeOnComplete: { count: 1000 } } });
  queue.on("error", () => {});
  let writes = 0;
  let state = "pending";
  const worker = new Worker(name, async () => {
    if (isRetiredDeployment(state)) return;
    writes++;
    state = "completed";
  }, { connection: consumer });
  worker.on("error", () => {});
  try {
    await worker.waitUntilReady();
    await queue.add("delivery", {}, { jobId: "stable-run" });
    await until(async () => (await queue.getJob("stable-run"))?.isCompleted() ?? false);
    await queue.add("delivery", {}, { jobId: "stable-run" });
    expect(await queue.getCompletedCount()).toBe(1);
    expect(writes).toBe(1);
    await (await queue.getJob("stable-run"))!.remove();
    await queue.add("delivery", {}, { jobId: "stable-run" });
    await until(async () => (await queue.getJob("stable-run"))?.isCompleted() ?? false);
    expect(writes).toBe(1);
  } finally {
    await worker.close(); await queue.obliterate({ force: true }); await queue.close();
    producer.disconnect(); consumer.disconnect();
  }
}, 15000);

fixture("killing the worker owner releases its session lock and only one replacement can acquire it", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", `${import.meta.dir}/fixtures/hardeningWorker.ts`], {
    env: { PATH: process.env.PATH ?? "", HARDENING_SERVICES: "owned-local" }, stdout: "pipe", stderr: "ignore",
  });
  let replacement: WorkerOwnership | undefined;
  const reader = child.stdout.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const first = await Promise.race([reader.read(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Fixture worker did not acquire ownership")), 5000);
    })]);
    clearTimeout(timer);
    expect(new TextDecoder().decode(first.value)).toBe("OWNED\n");
    await expect(WorkerOwnership.acquire(databaseUrl, () => {})).rejects.toThrow("Another InfraForge worker");
    child.kill("SIGKILL");
    await child.exited;
    replacement = await WorkerOwnership.acquire(databaseUrl, () => {});
    await expect(replacement.assertHeld()).resolves.toBeUndefined();
    await expect(WorkerOwnership.acquire(databaseUrl, () => {})).rejects.toThrow("Another InfraForge worker");
  } finally {
    clearTimeout(timer);
    child.kill("SIGKILL"); await child.exited;
    reader.releaseLock();
    await replacement?.close();
  }
}, 15000);
