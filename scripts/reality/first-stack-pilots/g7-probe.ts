import { RedisClient } from "bun";
import { appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { environment, telemetry } from "./telemetry";

const manifest = JSON.parse(readFileSync("/harness/g7-manifest.json", "utf8"));
mkdirSync("/out", { recursive: true });
const file = "/out/g7.jsonl", log = (row: unknown) => appendFileSync(file, JSON.stringify(row) + "\n");
const server = Bun.spawn(["valkey-server", "--bind", "127.0.0.1", "--port", "6379", "--save", "", "--appendonly", "no", "--maxmemory", String(manifest.maxmemory), "--maxmemory-policy", "noeviction"], { stdout: Bun.file("/out/valkey.log"), stderr: Bun.file("/out/valkey-stderr.log") });
let client: RedisClient | undefined;
const command = async (name: string, ...args: string[]) => client!.send(name, args);
const info = async () => {
  const raw: string = await command("INFO", "all");
  return Object.fromEntries(raw.split("\r\n").filter(l => l.includes(":")).map(l => { const at = l.indexOf(":"); return [l.slice(0, at), l.slice(at + 1)]; }));
};
const value = (version = 1) => JSON.stringify({ version }).padEnd(manifest.valueBytes, " ");
const reset = async (policy = "noeviction") => { await command("CONFIG", "SET", "maxmemory", "0"); await command("FLUSHALL"); await command("CONFIG", "SET", "maxmemory-policy", policy); };
const set = async (key: string, body = value(), ttlMs?: number) => {
  try { await command("SET", key, body, ...(ttlMs ? ["PX", String(ttlMs)] : [])); return { acknowledged: true, reason: null }; }
  catch (e) { return { acknowledged: false, reason: String(e) }; }
};
try {
  log({ kind: "environment", environment: environment(), manifest, before: telemetry(), backing: "actual in-process keyed function calls; no PostgreSQL/DB CPU claim" });
  for (let i = 0; ; i++) {
    try { client = new RedisClient("redis://127.0.0.1:6379", { maxRetries: 0 }); await client.connect(); await command("PING"); break; }
    catch { client?.close(); if (i >= 40) throw Error("Valkey readiness failed"); await Bun.sleep(50); }
  }
  log({ kind: "server", version: await command("INFO", "server"), config: await command("CONFIG", "GET", "maxmemory", "maxmemory-policy", "maxmemory-samples", "save", "appendonly"), before: telemetry() });
  for (let repeat = 0; repeat < manifest.repeats; repeat++) for (const policy of manifest.policies) for (const size of manifest.workingSets) for (const warm of [false, true]) {
    await reset(policy);
    // Warm exactly the finite set with the cap disabled, then apply actual
    // maxmemory. The oversized warm case deliberately starts above the cap.
    if (warm) for (let k = 0; k < size; k++) await set(`key:${k}`);
    await command("CONFIG", "SET", "maxmemory", String(manifest.maxmemory));
    const id = `${repeat}:${policy}:${size}:${warm ? "warm" : "cold"}`, before = await info();
    log({ kind: "window-start", id, repeat, policy, size, warm, before, telemetry: telemetry() });
    for (let ordinal = 0; ordinal < size * 2; ordinal++) {
      const key = `key:${ordinal % size}`, startedUs = performance.now() * 1000;
      const cached: string | null = await command("GET", key);
      const fill = cached === null ? await set(key) : null;
      log({ kind: "lookup", id, ordinal, key, hit: cached !== null, backingCalls: cached === null ? 1 : 0, fill,
        valueBytes: cached === null ? manifest.valueBytes : Buffer.byteLength(cached), startedUs, finishedUs: performance.now() * 1000, poolWaitUs: 0,
        poolWaitMeaning: "single serial issuer, no app pool contention in this window" });
    }
    const after = await info(), victims: string[] = [];
    // EXISTS does not alter INFO GET hit/miss counters; take the end snapshot
    // first so victim-set inspection never enters a window population.
    for (let k = 0; k < size; k++) if (!await command("EXISTS", `key:${k}`)) victims.push(`key:${k}`);
    log({ kind: "window-end", id, after, victims, telemetry: telemetry() });
  }
  // Frozen skewed trace is withheld from the sequential windows above.
  await reset("allkeys-lru"); await command("CONFIG", "SET", "maxmemory", String(manifest.maxmemory));
  const id = "holdout-square-modulo", before = await info(); log({ kind: "window-start", id, policy: "allkeys-lru", size: manifest.holdout.workingSet, warm: false, holdout: true, before });
  for (let ordinal = 0; ordinal < manifest.holdout.rows; ordinal++) {
    const key = `key:${(ordinal * ordinal) % manifest.holdout.workingSet}`, cached = await command("GET", key);
    log({ kind: "lookup", id, ordinal, key, hit: cached !== null, backingCalls: cached === null ? 1 : 0, fill: cached === null ? await set(key) : null });
  }
  log({ kind: "window-end", id, after: await info(), victims: null });
  await reset();
  const expiryBefore = await info(); await set("ttl-key", value(), 40);
  const ttl = await command("PTTL", "ttl-key"), initial = await command("GET", "ttl-key");
  await Bun.sleep(80); const expired = await command("GET", "ttl-key");
  log({ kind: "ttl", key: "ttl-key", authoredTtlMs: 40, observedPttlMs: ttl, initialHit: initial !== null, expiredMiss: expired === null, before: expiryBefore, after: await info() });
  for (const coalesce of [false, true]) {
    await reset(); let backingCalls = 0; const pending = new Map<string, Promise<string>>();
    const key = "stampede-key", before = await info();
    // Complete all three real GETs before releasing the backing function.
    const reads = await Promise.all([0, 1, 2].map(async ordinal => ({ ordinal, cached: await command("GET", key) })));
    const calls = reads.map(async r => {
      const fetch = async () => { backingCalls++; await Bun.sleep(manifest.stampede.originHoldMs); return value(); };
      let body: string;
      if (coalesce) { if (!pending.has(key)) pending.set(key, fetch().then(async body => { const fill = await set(key, body); log({ kind: "stampede-fill", coalesce, key, fill }); return body; })); body = await pending.get(key)!; }
      else { body = await fetch(); log({ kind: "stampede-fill", coalesce, key, fill: await set(key, body) }); }
      return { ordinal: r.ordinal, key, hit: r.cached !== null, bytes: Buffer.byteLength(body) };
    });
    log({ kind: "stampede", coalesce, roots: await Promise.all(calls), backingCalls, before, after: await info(), originHoldMs: manifest.stampede.originHoldMs });
  }
  // Single-process application generation guard; Valkey does not supply the
  // simulator's invalidation token. Record the actual rejected stale fill.
  await reset(); let generation = 0; const token = generation, stale = value(1);
  await set("write-key", stale); generation++; await command("DEL", "write-key");
  const staleFillRefused = token !== generation; if (!staleFillRefused) await set("write-key", stale);
  const afterInvalidation = await command("GET", "write-key"); await set("write-key", value(2));
  const current = await command("GET", "write-key");
  log({ kind: "invalidation", key: "write-key", token, generation, staleFillRefused, afterInvalidation, currentVersion: JSON.parse(current).version,
    guard: "single app generation policy; distributed invalidation/atomicity unsupported" });
  log({ kind: "end", after: telemetry(), perCommandCpuCoreUs: null });
} catch (e) { log({ kind: "failure", error: String(e) }); process.exitCode = 1; }
finally { client?.close(); server.kill(); await server.exited; }
