import { Worker } from "node:worker_threads";
import { appendFileSync, writeFileSync } from "node:fs";
import { environment, telemetry } from "./telemetry";

const config = JSON.parse(process.argv[2]!);
writeFileSync("/out/startup-config.json", JSON.stringify(config, null, 2) + "\n");
const out = "/out/app.jsonl";
const emit = (row: unknown) => appendFileSync(out, JSON.stringify(row) + "\n");
let sql = new Bun.SQL(`postgres://postgres@${config.postgresHost}:5432/pilot`, { max: config.pool, idleTimeout: 0, connectionTimeout: 5 });
for (let attempt = 0; ; attempt++) {
  try { await sql`CREATE TABLE IF NOT EXISTS pilot_keys (id integer PRIMARY KEY, value text NOT NULL)`; break; }
  catch (error) { emit({ kind: "startup-error", attempt, error: String(error) }); if (attempt >= 5) throw error; await sql.close({ timeout: 0 }); await Bun.sleep(500); sql = new Bun.SQL(`postgres://postgres@${config.postgresHost}:5432/pilot`, { max: config.pool, idleTimeout: 0, connectionTimeout: 5 }); }
}
await sql`INSERT INTO pilot_keys SELECT i, repeat('x',64) FROM generate_series(1,1024) i ON CONFLICT DO NOTHING`;
const dbSettings = await sql`SELECT name, setting, unit FROM pg_settings WHERE name IN ('server_version','max_connections','shared_buffers','fsync','synchronous_commit','default_transaction_isolation','statement_timeout','data_directory') ORDER BY name`;
const plan = await sql`EXPLAIN (FORMAT JSON) SELECT value FROM pilot_keys WHERE id=1`;
writeFileSync("/out/app-environment.json", JSON.stringify({ ...environment(), config, dbSettings, plan,
  sql: "SELECT value FROM pilot_keys WHERE id=$1", keyRule: "1 + rootOrdinal % 1024", datasetRows: 1024,
  requestBodyBytes: 0, valueBytes: 64, isolation: "read committed, read-only autocommit statement",
  cancellation: "caller abort does not cancel admitted server work; queued deadline checked on dispatch; no retries",
}, null, 2) + "\n");
type Job = { id: string; operation: string; receivedUs: number; deadlineUs: number; key: number; resolve: (r: Response) => void };
const queue: Job[] = [];
let active = 0, poolActive = 0, ready = 0;
const poolWaiters: (() => void)[] = [];
async function acquire() { if (poolActive >= config.pool) await new Promise<void>((r) => poolWaiters.push(r)); else poolActive++; }
function release() { const waiter = poolWaiters.shift(); if (waiter) waiter(); else poolActive--; }
const lanes = Array.from({ length: config.workers }, () => ({ worker: new Worker(new URL("./worker.ts", import.meta.url)), busy: false }));
await Promise.all(lanes.map(({ worker }) => new Promise<void>((resolve, reject) => { worker.once("message", () => { ready++; resolve(); }); worker.once("error", reject); })));
function drain() {
  for (const lane of lanes) {
    if (lane.busy || !queue.length) continue;
    const job = queue.shift()!, dispatchUs = performance.now() * 1000;
    if (dispatchUs >= job.deadlineUs) {
      emit({ kind: "root", ...base(job), dispatchUs, outcome: "queue-deadline", completedUs: dispatchUs, threadCpuUs: null, poolWaitUs: null });
      job.resolve(new Response("deadline", { status: 504 })); queueMicrotask(drain); continue;
    }
    lane.busy = true; active++;
    void (async () => {
      let worker: Record<string, unknown> | null = null, poolStartUs: number | null = null, poolEndUs: number | null = null, queryStartUs: number | null = null, queryEndUs: number | null = null;
      let outcome = "completed", status = 200, body = "ok";
      try {
        if (job.operation === "point-read") {
          poolStartUs = performance.now() * 1000; await acquire(); poolEndUs = performance.now() * 1000;
          try { queryStartUs = performance.now() * 1000; const rows = await sql`SELECT value FROM pilot_keys WHERE id=${job.key}`; body = rows[0].value; queryEndUs = performance.now() * 1000; } finally { release(); }
        } else {
          worker = await new Promise((resolve, reject) => {
            const error = (e: Error) => { lane.worker.off("message", message); reject(e); };
            const message = (m: Record<string, unknown>) => { lane.worker.off("error", error); resolve(m); };
            lane.worker.once("message", message); lane.worker.once("error", error);
            lane.worker.postMessage({ id: job.id, operation: job.operation, iterations: config.iterations });
          });
        }
      } catch (e) { outcome = "error"; status = 500; body = String(e); }
      const completedUs = performance.now() * 1000;
      emit({ kind: "root", ...base(job), dispatchUs, completedUs, outcome, worker, poolStartUs, poolEndUs, queryStartUs, queryEndUs,
        threadCpuUs: worker?.threadCpuUs ?? null, poolWaitUs: poolStartUs === null ? null : poolEndUs! - poolStartUs,
        serverAfterDeadline: completedUs >= job.deadlineUs, responseBodyBytes: Buffer.byteLength(body), commitUs: null });
      job.resolve(new Response(body, { status })); active--; lane.busy = false; drain();
    })();
  }
}
function base(job: Job) { return { id: job.id, attempt: 1, operation: job.operation, key: job.key, receivedUs: job.receivedUs, queueEnterUs: job.receivedUs, deadlineUs: job.deadlineUs }; }
let tick = performance.now(), delays: number[] = [];
setInterval(() => { const now = performance.now(); delays.push(Math.max(0, now - tick - 10) * 1000); tick = now; }, 10);
setInterval(() => { emit({ kind: "sample", ...telemetry(), active, queued: queue.length, poolActive, poolQueued: poolWaiters.length,
  eventLoopDelayUs: { count: delays.length, max: delays.length ? Math.max(...delays) : null, mean: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null } }); delays = []; }, 1000);
Bun.serve({ port: 8080, idleTimeout: 10, fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/ready") return Response.json({ ready, active, queued: queue.length });
  const id = request.headers.get("x-root-id"), operation = url.pathname.slice(1), receivedUs = performance.now() * 1000;
  if (!id || !["empty", "cpu", "point-read"].includes(operation)) return new Response("invalid", { status: 400 });
  const jobBase = { id, operation, receivedUs, deadlineUs: receivedUs + config.deadlineMs * 1000, key: Number(request.headers.get("x-key")) };
  if (queue.length >= config.queue) { emit({ kind: "root", ...jobBase, attempt: 1, outcome: "rejected", completedUs: receivedUs, dispatchUs: null, threadCpuUs: null, poolWaitUs: null }); return new Response("busy", { status: 503 }); }
  return new Promise<Response>((resolve) => { queue.push({ ...jobBase, resolve }); drain(); });
} });
