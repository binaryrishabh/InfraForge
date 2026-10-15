import { networkFixture } from "./networkFixture";
import { quantities } from "./workloadFixture";
import type { DataInput, RelationalConfig, CacheConfig, AsideConfig } from "../src/model2/data/contracts";
import type { ComputeResource } from "../src/model2/compute/contracts";
export function dataFixture(options: Parameters<typeof networkFixture>[0] & { keys?: number; coalesce?: boolean; capacity?: number; ttl?: number; dbCpu?: number; sessions?: number; activeTransactions?: number } = {}): DataInput {
  const base = networkFixture({ count: 20, interval: 500, horizon: 30000, timeout: 20000, cpu: 50, slots: 8, connections: 8, streams: 1, bytes: 8, responseBytes: 64, bandwidth: 100000000, propagation: 1, establish: 10, raw: 2000, ...options }), q = quantities("Synthetic M2E relational/cache mechanism proof; no provider or measured performance validity");
  const app = base.resources[0] as ComputeResource, execution = (id: string): ComputeResource => ({ ...structuredClone(app), id, memory: { coverage: "partial", policy: "observe" } });
  const initial = Array.from({ length: options.keys ?? 4 }, (_, i) => ({ key: `k${i}`, version: 1, bytes: q.q(`row.${i}.bytes`, 64, "bytes") }));
  const database: RelationalConfig = { id: "db", kind: "relational", semantics: "read-committed-keyed/1", execution: execution("db"), maxSessions: q.q("db.sessions", options.sessions ?? 8, "count"), activeTransactions: q.q("db.active", options.activeTransactions ?? 4, "count"), pendingQueries: q.q("db.pending", 1000, "count"), keys: initial.map((r) => r.key), initial, plans: Object.fromEntries(base.operations.map((op) => [op.id, {
    statements: [{ kind: op.id === "heavy" ? "write" : "snapshot-read", keys: ["$key"], cpu: q.q(`db.${op.id}.cpu`, options.dbCpu ?? 500, "cpu-us"), parallelism: q.q(`db.${op.id}.parallelism`, 1, "cores"), blockingWait: q.q(`db.${op.id}.blocking`, 0, "us"), logBytes: q.q(`db.${op.id}.log`, op.id === "heavy" ? 64 : 0, "bytes") }],
    statementTimeout: q.q(`db.${op.id}.statementTimeout`, 20000, "us"), lockTimeout: q.q(`db.${op.id}.lockTimeout`, 10000, "us"), transactionTimeout: q.q(`db.${op.id}.transactionTimeout`, 25000, "us"), commitWait: q.q(`db.${op.id}.commit`, 0, "us"), durability: "logical-only",
  }])) };
  const cache: CacheConfig = { id: "cache", kind: "cache", semantics: "keyed-cache/1", execution: execution("cache"), capacity: q.q("cache.capacity", options.capacity ?? 1024, "bytes"), entryOverhead: q.q("cache.overhead", 16, "bytes"), policy: "lru", ttl: q.q("cache.ttl", options.ttl ?? 5000, "us"), initial: [], commandCpu: q.q("cache.cpu", 10, "cpu-us") };
  const aside: AsideConfig = { id: "aside", kind: "cache-aside", execution: execution("aside"), cache: "cache", database: "db", keys: initial.map((r) => r.key), access: "cycle", coalesce: options.coalesce ?? false, onCacheFailure: "database", invalidateWrites: true, operations: { light: "read", heavy: "write" } };
  app.downstream = "aside";
  const input: DataInput = { ...base, workloadVersion: "m2e/1", resources: [app, aside, cache, database, { id: "lb", kind: "load-balancer", backends: ["app"], policy: "round-robin", maxOutstanding: q.q("lb.outstanding", 1000, "count"), maxPending: q.q("lb.pending", 1000, "count"), pendingTimeout: q.q("lb.pendingTimeout", 20000, "us"), health: { initial: "eligible", interval: q.q("lb.health.interval", 100000, "us"), timeout: q.q("lb.health.timeout", 20000, "us"), healthy: q.q("lb.health.healthy", 1, "count"), unhealthy: q.q("lb.health.unhealthy", 2, "count"), operation: "light" } }],
    endpoints: Object.fromEntries(["app", "aside", "cache", "db", "lb"].map((id) => [id, { alive: true, ready: true }])), paths: [], links: [], dataInterventions: [] };
  input.operations.forEach((o) => o.entry = "lb");
  for (const [source, target] of [["$caller", "lb"], ["lb", "app"], ["app", "aside"], ["aside", "cache"], ["aside", "db"]]) {
    const id = `${source}:${target}`, request = `${id}:req`, response = `${id}:res`;
    input.links.push({ ...base.links[0]!, id: request, from: source!, to: target! }, { ...base.links[1]!, id: response, from: target!, to: source! });
    input.paths.push({ ...structuredClone(base.paths[0]!), id, source: source!, target: target!, request: [request], response: [response] });
  }
  input.ledger.push(...q.ledger); return input;
}
