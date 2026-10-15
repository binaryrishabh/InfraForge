import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { EventKernel } from "../../packages/simulation/src/model2/time";
import { connectionPool } from "../../packages/simulation/src/model2/network/pool";
import { relationalDatabase } from "../../packages/simulation/src/model2/data/database";
import { keyedCache } from "../../packages/simulation/src/model2/data/cache";
import { DATA_POLICY_LEDGER } from "../../packages/simulation/src/model2/data/policy";
import type { RelationalConfig, DataReply } from "../../packages/simulation/src/model2/data/contracts";
import type { Quantity, Unit } from "../../packages/simulation/src/reality/quantity";
import type { RealityEntry } from "../../packages/simulation/src/reality/ledger";
interface DatabaseBatch { id: string; kind: string; pool: number; concurrency: number; operations: number; repeat: number; split: string; configurationHoldout: boolean; wallUs: number; throughput: number; containerCpuUs: number; results: Array<{ id: number; responseUs: number; acquisitionUs: number }> }
interface CacheBatch { id: string; bytes: number; workingSet: number; warm: boolean; concurrency: number; repeat: number; split: string; configurationHoldout: boolean; operations: number; hits: number; misses: number; wallUs: number; throughput: number; results: Array<{ id: number; hit: boolean; responseUs: number }> }
interface Campaign { schema: string; date: string; sourceHash: string; environment: string; host: unknown; versions: unknown; database: DatabaseBatch[]; cache: CacheBatch[]; cleanup: { complete: boolean; errors: string[] }; semantics: unknown }
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
export const readDataMeasurements = (): Campaign => JSON.parse(readFileSync(new URL("../../docs/reality/m2e-measurements.json", import.meta.url), "utf8"));
export function dataCalibration(data: Campaign) {
  const hash = createHash("sha256").update(readFileSync(new URL("./data-benchmark.mjs", import.meta.url))).digest("hex");
  if (data.schema !== "infraforge-data-observations/1" || data.sourceHash !== hash || createHash("sha256").update(JSON.stringify({ host: data.host, versions: data.versions })).digest("hex") !== data.environment || !data.cleanup.complete || data.cleanup.errors.length || data.database.length !== 60 || data.cache.length !== 54) throw Error("Data measurement source/environment/cleanup drift");
  for (const group of [data.database, data.cache]) {
    if (new Set(group.map((r) => r.id)).size !== group.length) throw Error("Duplicate measurement identity");
    for (const r of group) if (r.operations !== 128 || r.results.length !== 128 || new Set(r.results.map((v) => v.id)).size !== 128 || r.results.some((v) => !Number.isInteger(v.id) || v.id < 0 || v.id >= 128 || !Number.isFinite(v.responseUs) || v.responseUs < 0) || !(r.wallUs > 0) || Math.abs(r.throughput - 128000000 / r.wallUs) > 1e-6) throw Error("Invalid data observation");
  }
  for (const r of data.database) if (![1, 2, 4, 8].includes(r.pool) || ![0, 1, 2].includes(r.repeat) || !["point-read", "range-read", "independent-update", "hot-update", "two-statement"].includes(r.kind) || r.concurrency !== 8 || r.id !== `${r.kind}/${r.pool}/${r.repeat}` || r.configurationHoldout !== [2, 8].includes(r.pool) || r.split !== (r.configurationHoldout || r.repeat === 2 ? "holdout" : "fit") || !(r.containerCpuUs > 0)) throw Error("Invalid database fit split");
  for (const r of data.cache) if (![64, 4096, 65536].includes(r.bytes) || ![1, 16, 64].includes(r.workingSet) || ![0, 1, 2].includes(r.repeat) || typeof r.warm !== "boolean" || r.id !== `${r.bytes}/${r.workingSet}/${r.warm}/${r.repeat}` || r.configurationHoldout !== (r.bytes === 4096 || r.workingSet === 16) || r.split !== (r.configurationHoldout || r.repeat === 2 ? "holdout" : "fit") || r.hits + r.misses !== 128) throw Error("Invalid cache fit split");
  const ledger = new Map<string, RealityEntry>();
  const q = <U extends Unit>(id: string, value: number, unit: U, classification: RealityEntry["classification"] = "user-input"): Quantity<U> & { kind: "known"; value: number } => {
    const quantity: Quantity<U> & { kind: "known"; value: number } = { kind: "known", value, unit, provenance: [id] };
    ledger.set(id, { id, concept: id, modelVersion: "2", scope: "Local finite PG/Redis campaign replay only", validityDomain: `${hash}/${data.environment}; exact workload/configuration only`, quantity, classification, confidence: "conditional", formula: classification === "calibrated-model" ? "Ceiling mean fitting container CPU delta / operations; includes background overhead" : "Explicit finite experiment/replay input; not inferred physical latency", provenance: [{ source: classification === "calibrated-model" ? "docs/reality/m2e-measurements.json" : "scripts/reality/data-benchmark.mjs", supports: classification === "calibrated-model" ? "exact" : "implementation", detail: "Retained raw observations; only fitting CPU deltas contribute to candidates" }], assumptions: ["Container CPU is aggregate, not identified per-query CPU", "No fitted network/runtime/storage residual", "No cloud, provider, SKU or Free Mode validity"], researchedOn: data.date.slice(0, 10), freeMode: "forbidden", replacement: "Separate server CPU/background work, transport/runtime and storage measurements" }); return quantity;
  };
  const candidates = [...new Set(data.database.filter((r) => r.split === "fit").map((r) => `${r.kind}/${r.pool}`))].map((id) => {
    const rows = data.database.filter((r) => r.split === "fit" && `${r.kind}/${r.pool}` === id); if (rows.length !== 2 || rows.some((r) => r.configurationHoldout)) throw Error("Fit leakage");
    const cpu = q(`m2e.candidate.${id}.cpu`, Math.ceil(mean(rows.map((r) => r.containerCpuUs / r.operations))), "cpu-us", "calibrated-model");
    return { id, kind: rows[0]!.kind, pool: rows[0]!.pool, cpu, fitIds: rows.map((r) => r.id), status: "conditional aggregate-CPU surrogate; not accepted physical query demand", freeMode: "forbidden" };
  });
  const results = data.database.map((r) => {
    const prefix = `m2e.replay.${r.kind}.${r.pool}`, localQ = <U extends Unit>(name: string, value: number, unit: U) => q(`${prefix}.${name}`, value, unit);
    const candidate = candidates.find((c) => c.id === `${r.kind}/${r.pool}`), demand = candidate?.cpu.value ?? Math.ceil(mean(candidates.filter((c) => c.kind === r.kind).map((c) => c.cpu.value)));
    const cpu = candidate?.cpu ?? q(`${prefix}.unsupportedCpuTransfer`, demand, "cpu-us", "educational-assumption");
    const cores = localQ("cores", 1, "cores"), count = (name: string, value: number) => localQ(name, value, "count"), bound = localQ("finiteBound", 100000000, "us");
    const statement = { kind: r.kind.includes("update") || r.kind === "two-statement" ? "write" as const : "snapshot-read" as const, keys: r.kind === "range-read" ? Array.from({ length: 16 }, (_, i) => `k${i}`) : ["$key"], cpu, parallelism: cores, blockingWait: localQ("authoredBlocking", 0, "us"), logBytes: localQ("logicalLogUnspecified", 0, "bytes") };
    const statements = r.kind === "two-statement" ? [{ ...statement, cpu: localQ("halfCpu", demand / 2, "cpu-us") }, { ...statement, kind: "snapshot-read" as const, cpu: localQ("halfCpu", demand / 2, "cpu-us") }] : [statement];
    const config: RelationalConfig = { id: "db", kind: "relational", semantics: "read-committed-keyed/1", execution: { id: "db", kind: "compute", cores, workers: count("sessions", r.pool), scheduler: "capped-equal-fluid/1", memory: { coverage: "partial", policy: "observe" }, queueCapacity: count("queue", 128), profiles: {}, context: { labels: {}, quantities: {} }, cancellation: "unsupported" }, maxSessions: count("sessions", r.pool), activeTransactions: count("active", r.pool), pendingQueries: count("pending", 128), keys: Array.from({ length: 256 }, (_, i) => `k${i}`), initial: Array.from({ length: 256 }, (_, i) => ({ key: `k${i}`, version: 1, bytes: localQ("value", 64, "bytes") })), plans: { query: { statements, statementTimeout: bound, lockTimeout: bound, transactionTimeout: bound, commitWait: localQ("logicalCommit", 0, "us"), durability: "logical-only" } } };
    const kernel = new EventKernel(100000), db = relationalDatabase(config, kernel), pool = connectionPool("pg", { mode: "serial", reuse: true, maxConnections: count("sessions", r.pool), streams: count("streams", 1), pending: count("pending", 128), establish: localQ("injectedSetup", 0, "us"), acquireTimeout: bound, connectTimeout: bound, responseTimeout: bound, remoteCancellation: "detach" }, kernel, () => true);
    const modeled: Array<{ id: number; at: number; responseUs: number }> = []; let issued = 0;
    const offer = () => { if (issued === 128) return; const id = issued++, start = kernel.now;
      pool.acquire(String(id), (lease) => db.accept({ rootId: JSON.stringify([id]), callId: JSON.stringify([id]), operation: "query", attempt: 0, offeredAt: start, sessionId: lease.connection, message: { request: { kind: "query", key: `k${r.kind === "hot-update" ? 0 : id % 256}` } } }, (outcome) => {
        if (outcome !== "completed") throw Error("Database replay did not complete"); modeled.push({ id, at: kernel.now, responseUs: kernel.now - start }); lease.release(); offer();
      }), (reason) => { throw Error(reason); });
    };
    for (let i = 0; i < 8; i++) offer(); kernel.advanceTo(100000000); if (modeled.length !== 128) throw Error("Incomplete database replay");
    const throughput = 128000000 / Math.max(...modeled.map((v) => v.at)), errors = modeled.map((m) => m.responseUs - r.results.find((v) => v.id === m.id)!.responseUs);
    return { id: r.id, split: r.split, configurationHoldout: r.configurationHoldout, claim: candidate ? "discrete conditional CPU surrogate" : "unsupported pool-concurrency transfer diagnostic", measuredThroughput: r.throughput, modeledThroughput: throughput, throughputRelativeError: Math.abs(throughput - r.throughput) / r.throughput, responseMAEUs: mean(errors.map(Math.abs)), measuredMeanResponseUs: mean(r.results.map((v) => v.responseUs)), modelMeanResponseUs: mean(modeled.map((v) => v.responseUs)), commits: db.evidence().transactions.committed, modeledPoolCreated: pool.measure().created };
  });
  const cacheResults = data.cache.map((r) => {
    const prefix = `m2e.cacheReplay.${r.bytes}.${r.workingSet}`, cq = <U extends Unit>(name: string, value: number, unit: U) => q(`${prefix}.${name}`, value, unit, "educational-assumption");
    const cores = cq("cores", 1, "cores"), bytes = cq("bytes", r.bytes, "bytes"), initial = r.warm ? Array.from({ length: r.workingSet }, (_, i) => ({ key: `k${i}`, version: 1, bytes })) : [];
    const kernel = new EventKernel(10000), cache = keyedCache({ id: "cache", kind: "cache", semantics: "keyed-cache/1", execution: { id: "cache", kind: "compute", cores, workers: cq("commands", 1, "count"), scheduler: "capped-equal-fluid/1", memory: { coverage: "partial", policy: "observe" }, queueCapacity: cq("queue", 128, "count"), profiles: {}, context: { labels: {}, quantities: {} }, cancellation: "unsupported" }, capacity: cq("capacity", r.bytes * r.workingSet, "bytes"), entryOverhead: cq("injectedOverhead", 0, "bytes"), policy: "lru", ttl: cq("noExpiryWithinReplay", 1000000, "us"), initial, commandCpu: cq("logicalClockOnly", 1, "cpu-us") }, kernel);
    let command = 0, at = 0; const hitSequence: boolean[] = [];
    for (let id = 0; id < 128; id++) {
      const key = `k${id % r.workingSet}`, invocation = { rootId: JSON.stringify([id]), callId: JSON.stringify([command++]), operation: "get", attempt: 0, offeredAt: at, message: { request: { kind: "get", key }, response: undefined as DataReply | undefined } };
      cache.accept(invocation, () => {}); kernel.advanceTo(++at); const hit = invocation.message.response!.hit!; hitSequence.push(hit);
      if (!hit) { cache.accept({ ...invocation, callId: JSON.stringify([command++]), message: { request: { kind: "set", key, row: { version: 1, bytes: r.bytes } } } }, () => {}); kernel.advanceTo(++at); }
    }
    const evidence = cache.evidence(); if (r.results.some((v, i) => v.hit !== hitSequence[i]) || r.hits !== evidence.hits || r.misses !== evidence.misses) throw Error("Real/cache logical sequence mismatch");
    return { id: r.id, split: r.split, hits: evidence.hits, misses: evidence.misses, fills: evidence.fills, exactLogicalSequence: true, timingPrediction: "Unknown; no measured command CPU or identified transport/runtime demand" };
  });
  const summaries = ["fit", "holdout"].map((split) => { const rows = results.filter((r) => r.split === split); return { split, batches: rows.length, throughputMARE: mean(rows.map((r) => r.throughputRelativeError)), responseMAEUs: mean(rows.map((r) => r.responseMAEUs)) }; });
  return { schema: "infraforge-data-calibration/1", sourceHash: hash, environment: data.environment, acceptance: "Complete DB/cache timing predictor REJECTED: aggregate CPU does not identify query CPU; transport/runtime/storage residual unresolved. Cache logical semantics only.", candidates, summaries, results, cacheResults, ledger: [...ledger.values()], policyLedger: DATA_POLICY_LEDGER, semantics: data.semantics, measuredOperations: { database: 7680, cacheLookups: 6912 }, scope: "Exact local host/container/software/workloads; no network tuning, provider mapping or Free Mode validity" };
}
if (import.meta.main) {
  const report = dataCalibration(readDataMeasurements()), path = new URL("../../docs/reality/m2e-calibration.json", import.meta.url);
  if (process.argv.includes("--write")) writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  else if (JSON.stringify(report) !== JSON.stringify(JSON.parse(readFileSync(path, "utf8")))) throw Error("M2E calibration artifact drift");
  console.log(JSON.stringify({ verified: true, summaries: report.summaries, acceptance: report.acceptance }));
}
