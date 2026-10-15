import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, release } from "node:os";
const require = createRequire(new URL("../../apps/backend/package.json", import.meta.url));
const { Pool, Client } = require("pg"), Redis = require("ioredis");
const run = randomUUID().replaceAll("-", ""), prefix = `infraforge-m2e-${run}`, pgName = `${prefix}-pg`, redisName = `${prefix}-redis`, network = `${prefix}-net`;
const labels = { "infraforge.project": "binaryrishabh/InfraForge", "infraforge.purpose": "m2e-measurement", "infraforge.run": run, "infraforge.temporary": "true" };
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", windowsHide: true, timeout: 30000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const context = docker("context", "show"), endpoint = JSON.parse(docker("context", "inspect", context))[0].Endpoints.docker.Host;
if (process.env.DOCKER_HOST || !/^(npipe:\/\/|unix:\/\/)/.test(endpoint)) throw Error("Measurement requires local Docker pipe/socket without DOCKER_HOST override");
const labelArgs = Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clock = () => Number(process.hrtime.bigint()) / 1000;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const report = { schema: "infraforge-data-observations/1", date: new Date().toISOString(), run, sourceHash: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"), host: { node: process.version, platform: platform(), release: release(), cpu: cpus()[0].model, scope: "owner-local-disposable-containers" }, database: [], cache: [], semantics: {}, cleanup: { complete: false } };
const created = []; let netCreated = false;
try {
  docker("network", "create", ...labelArgs, network); netCreated = true;
  docker("run", "-d", "--pull=never", "--name", pgName, ...labelArgs, "--network", network, "--cpus=1", "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", "POSTGRES_DB=m2e_benchmark", "postgres:18-alpine"); created.push(pgName);
  docker("run", "-d", "--pull=never", "--name", redisName, ...labelArgs, "--network", network, "--cpus=1", "--publish", "127.0.0.1::6379", "--tmpfs", "/data", "redis:8-alpine", "redis-server", "--save", "", "--appendonly", "no"); created.push(redisName);
  const inspect = (name) => JSON.parse(docker("inspect", name))[0];
  const pgPort = Number(inspect(pgName).NetworkSettings.Ports["5432/tcp"][0].HostPort), redisPort = Number(inspect(redisName).NetworkSettings.Ports["6379/tcp"][0].HostPort);
  const pgConfig = { host: "127.0.0.1", port: pgPort, user: "postgres", database: "m2e_benchmark", connectionTimeoutMillis: 2000 };
  let setup;
  for (let i = 0; i < 40; i++) { try { setup = new Client(pgConfig); await setup.connect(); break; } catch { await setup?.end().catch(() => {}); setup = undefined; await sleep(250); } }
  if (!setup) throw Error("Disposable PostgreSQL readiness failed");
  const redis = new Redis({ host: "127.0.0.1", port: redisPort, lazyConnect: true, retryStrategy: null }); await redis.connect();
  try {
    report.versions = { postgres: (await setup.query("select version() as version")).rows[0].version, redis: (await redis.info("server")).match(/redis_version:([^\r]+)/)[1], pgImage: inspect(pgName).Image, redisImage: inspect(redisName).Image, cpuQuota: "--cpus=1 each; Docker VM/host scheduling remains variable", storage: "PostgreSQL tmpfs; no physical disk/durability timing claim" };
    await setup.query("create table items (id integer primary key, version bigint not null, value text not null); insert into items select n,1,repeat('x',64) from generate_series(0,255) n");
    const usage = () => Number(docker("exec", pgName, "cat", "/sys/fs/cgroup/cpu.stat").match(/usage_usec (\d+)/)[1]);
    for (const max of [1, 2, 4, 8]) for (const kind of ["point-read", "range-read", "independent-update", "hot-update", "two-statement"]) {
      const pool = new Pool({ ...pgConfig, max });
      try {
        await Promise.all(Array.from({ length: max }, () => pool.query("select 1")));
        for (let repeat = 0; repeat < 3; repeat++) {
          const results = [], cpuBefore = usage(), start = clock(); let next = 0;
          await Promise.all(Array.from({ length: 8 }, async () => {
            while (next < 128) { const id = next++, at = clock(), client = await pool.connect(), acquired = clock();
              try {
                if (kind === "point-read") await client.query("select version,value from items where id=$1", [id % 256]);
                else if (kind === "range-read") await client.query("select id,version from items where id >= $1 and id < $1+16 order by id", [id % 240]);
                else if (kind === "independent-update") await client.query("update items set version=version+1 where id=$1", [id % 256]);
                else if (kind === "hot-update") await client.query("update items set version=version+1 where id=0");
                else { await client.query("begin"); await client.query("update items set version=version+1 where id=$1", [id % 128]); await client.query("select version from items where id=$1", [id % 128]); await client.query("commit"); }
                results.push({ id, responseUs: clock() - at, acquisitionUs: acquired - at });
              } finally { client.release(); }
            }
          }));
          const wallUs = clock() - start, cpuUs = usage() - cpuBefore;
          report.database.push({ id: `${kind}/${max}/${repeat}`, kind, pool: max, concurrency: 8, operations: 128, repeat, split: [2, 8].includes(max) || repeat === 2 ? "holdout" : "fit", configurationHoldout: [2, 8].includes(max), wallUs, throughput: 128000000 / wallUs, containerCpuUs: cpuUs, results: results.sort((a, b) => a.id - b.id) });
        }
      } finally { await pool.end(); }
      console.log(JSON.stringify({ database: kind, pool: max, batches: report.database.length }));
    }
    // Independent semantic checks use real concurrent sessions with bounded statements.
    const writer = new Client(pgConfig), reader = new Client(pgConfig); await writer.connect(); await reader.connect();
    try {
      await writer.query("begin"); await writer.query("update items set version=version+1 where id=0");
      const at = clock(); const snapshot = await reader.query("select version from items where id=0"); const snapshotWallUs = clock() - at;
      await reader.query("set lock_timeout='100ms'"); let lockCode;
      try { await reader.query("update items set version=version+1 where id=0"); } catch (e) { lockCode = e.code; }
      await writer.query("rollback"); report.semantics.database = { snapshotReadReturnedWhileWriterHeld: snapshot.rowCount === 1, snapshotWallUs, conflictingUpdateCode: lockCode, rollbackReleased: true };
    } finally { await writer.end(); await reader.end(); }
    for (const bytes of [64, 4096, 65536]) for (const workingSet of [1, 16, 64]) for (const warm of [false, true]) {
      const prefixKey = `measure:${bytes}:${workingSet}:${warm}:`;
      for (let repeat = 0; repeat < 3; repeat++) {
        await redis.flushdb(); if (warm) for (let key = 0; key < workingSet; key++) await redis.set(`${prefixKey}${key}`, Buffer.alloc(bytes, 97));
        const results = []; let hits = 0, misses = 0; const start = clock();
        for (let id = 0; id < 128; id++) { const key = `${prefixKey}${id % workingSet}`, at = clock(), value = await redis.getBuffer(key); if (value) hits++; else { misses++; await redis.set(key, Buffer.alloc(bytes, 97)); } results.push({ id, hit: !!value, responseUs: clock() - at }); }
        const wallUs = clock() - start;
        report.cache.push({ id: `${bytes}/${workingSet}/${warm}/${repeat}`, bytes, workingSet, warm, concurrency: 1, repeat, split: bytes === 4096 || workingSet === 16 || repeat === 2 ? "holdout" : "fit", configurationHoldout: bytes === 4096 || workingSet === 16, operations: 128, hits, misses, wallUs, throughput: 128000000 / wallUs, meanResponseUs: mean(results.map((x) => x.responseUs)), results });
      }
    }
    await redis.flushdb(); await redis.set("ttl-proof", "value", "PX", 60); const before = await redis.get("ttl-proof"); await sleep(120); const after = await redis.get("ttl-proof");
    report.semantics.cache = { ttlPresentBefore: before !== null, ttlAbsentAfter: after === null, requestedTtlMs: 60, observationWaitMs: 120, memoryAttribution: "Unknown; INFO memory is not an entry-resident coefficient" };
  } finally { await setup.end(); await redis.quit().catch(() => redis.disconnect()); }
} finally {
  const cleanupErrors = [];
  for (const name of created.reverse()) { try { const info = JSON.parse(docker("inspect", name))[0]; if (Object.entries(labels).some(([k, v]) => info.Config.Labels[k] !== v)) throw Error("Fixture ownership mismatch"); docker("rm", "-f", name); } catch (e) { cleanupErrors.push(String(e)); } }
  if (netCreated) try { const info = JSON.parse(docker("network", "inspect", network))[0]; if (Object.entries(labels).some(([k, v]) => info.Labels[k] !== v)) throw Error("Network ownership mismatch"); docker("network", "rm", network); } catch (e) { cleanupErrors.push(String(e)); }
  report.cleanup = { complete: cleanupErrors.length === 0, errors: cleanupErrors }; report.environment = createHash("sha256").update(JSON.stringify({ host: report.host, versions: report.versions })).digest("hex");
  writeFileSync(new URL("../../docs/reality/m2e-measurements.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  if (cleanupErrors.length) throw Error("Owned fixture cleanup incomplete; inspect run labels");
}
console.log(JSON.stringify({ complete: true, databaseBatches: report.database.length, cacheBatches: report.cache.length, cleanup: report.cleanup }));
