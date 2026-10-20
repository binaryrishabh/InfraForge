import { z } from "zod";
import { FIRST_STACK_COMPILER, FIRST_STACK_PROFILE, firstStackClaims, firstStackLimits as limits } from "@infraforge/contracts/first-stack";
import type { FirstStackDiagnostic, FirstStackSemantic } from "@infraforge/contracts/first-stack";
import { LayoutSchema } from "../zod_schemas/layout.schema";
import { designRevision } from "./canonical";

const id = z.string().min(1).max(256).refine(s => !Object.hasOwn(Object.prototype, s));
const count = z.number().int().min(0).max(1_000_000);
const positive = count.positive();
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const time = amount.max(limits.durationUs);
const cores = z.number().positive().max(1024);
const port = z.number().int().min(1).max(65535);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const sourceSchema = z.object({ id, version: id, origin: z.enum(["authored", "measured"]),
  workloadDomain: id, runtime: id, hardware: id, sources: z.array(id).min(1).max(32),
  measurement: z.object({ uncertainty: id, fitIdentity: id, holdoutIdentity: id.nullable(), conditions: id,
    cpuMethod: z.enum(["thread-core-time", "process-core-time"]) }).strict().optional(),
}).strict().superRefine((source, context) => {
  if (source.origin === "measured" && !source.measurement) context.addIssue({ code: "custom", path: ["measurement"], message: "Measured demand needs core-time methodology, conditions, uncertainty and fit/holdout identity; response latency is not CPU demand." });
});
export const sidecarSchema = z.object({
  schema: z.literal("infraforge-first-stack-sidecar/1"), profile: z.literal(FIRST_STACK_PROFILE), compiler: z.literal(FIRST_STACK_COMPILER),
  designRevision: digest, application: sourceSchema,
  operations: z.array(z.object({ id, kind: z.enum(["cpu-control", "point-read", "range-read", "update", "hot-update", "cache-read", "health-read"]),
    plan: id, deadlineUs: time.positive(), requestBytes: amount.nullable(), responseBytes: amount.nullable(),
    cpuUs: time, parallelism: cores, blockingUs: time, residentBytes: amount.nullable() }).strict()).min(1).max(limits.operations),
  nodes: z.array(z.object({ id, owner: z.enum(["load-balancer", "compute", "relational", "keyed-cache"]),
    host: id, cores, memoryBytes: amount.nullable(), reservationBytes: amount.nullable(),
    workers: positive, queue: count, listenerPort: port, cancellation: z.enum(["detach", "request-cancellation"]) }).strict()).min(3).max(11),
  caller: z.object({ entry: id, port, transport: z.literal("plain-serial/1"), connections: positive, pending: count,
    timeoutUs: time.positive(), requestBytes: amount.nullable(), responseBytes: amount.nullable(), requestLink: id, responseLink: id }).strict(),
  paths: z.array(z.object({ id, source: id, target: id, purpose: z.enum(["routing", "dependency"]),
    port, transport: z.literal("plain-serial/1"), connections: positive,
    pending: count, timeoutUs: time.positive(), requestBytes: amount.nullable(), responseBytes: amount.nullable(),
    requestLink: id, responseLink: id }).strict()).max(32),
  links: z.array(z.object({ id, bytesPerSecond: amount.positive(), latencyUs: time, queueBytes: amount }).strict()).max(64),
  placement: z.array(z.object({ id, cores, memoryBytes: amount.nullable() }).strict()).min(1).max(11),
  balancer: z.object({ policy: z.enum(["round-robin", "least-outstanding"]), outstanding: positive, pending: count,
    timeoutUs: time.positive(), healthOperation: id, intervalUs: time.positive(), healthy: positive, unhealthy: positive,
    allUnhealthy: z.literal("reject") }).strict(),
  database: z.object({ semantics: z.literal("read-committed-keyed/1"), keys: z.array(id).min(1).max(limits.keys),
    maxSessions: positive, activeTransactions: positive, pendingQueries: count,
    initial: z.array(z.object({ key: id, version: amount, bytes: amount }).strict()).max(limits.keys),
    plans: z.array(z.object({ id, kind: z.enum(["read", "write"]), keys: z.union([z.literal("recorded"), z.array(id).min(1).max(128)]),
      cpuUs: time, parallelism: cores, blockingUs: time, logBytes: amount,
      statementTimeoutUs: time.positive(), lockTimeoutUs: time.positive(), transactionTimeoutUs: time.positive(),
      commitWaitUs: time, durability: z.enum(["logical-only", "authored-log-ack"]) }).strict()).min(1).max(limits.operations) }).strict(),
  workload: z.object({ scheduleHash: digest, parametersHash: digest }).strict().nullable(), faults: z.tuple([]),
  metrics: z.literal("first-stack-metrics/1"), retention: z.literal("first-stack-bounded/1"), sources: z.array(id).min(1).max(32),
  migration: z.object({ kind: z.literal("reviewed-copy"), fromInfrastructureId: id, fromRevision: digest, reviewedBy: id }).strict().optional(),
}).strict();

const poolSchema = z.object({ reuse: z.boolean(), establishUs: time, acquireTimeoutUs: time.positive(),
  connectTimeoutUs: time.positive(), responseTimeoutUs: time.positive(), idleTimeoutUs: time.positive().nullable(),
  remoteCancellation: z.enum(["detach", "request-cancellation"]) }).strict();
export const sidecarV2Schema = sidecarSchema.extend({
  faults: z.array(z.discriminatedUnion("kind", [
    z.object({ schema: z.literal("first-stack-fault/1"), id, atUs: time, target: id, kind: z.literal("app-process-crash"), downtimeUs: time.positive(), recoveryUs: time.positive() }).strict(),
    z.object({ schema: z.literal("first-stack-fault/1"), id, atUs: time, target: id, kind: z.literal("directed-delay"), durationUs: time.positive(), delayUs: time }).strict(),
    z.object({ schema: z.literal("first-stack-fault/1"), id, atUs: time, target: id, kind: z.literal("directed-partition"), durationUs: time.positive() }).strict(),
  ])).max(64),
  retry: z.object({ schema: z.literal("first-stack-read-retry/1"), owner: z.literal("load-balancer"), operations: z.array(id).min(1).max(limits.operations),
    maxAttempts: z.literal(2), backoffUs: time.positive(), maxConcurrentRetries: positive.max(10000) }).strict().optional(),
  schema: z.literal("infraforge-first-stack-sidecar/2"), compiler: z.literal("first-stack-compiler/2"),
  links: z.array(sidecarSchema.shape.links.element.extend({ from: id, to: id })).max(64),
  paths: z.array(sidecarSchema.shape.paths.element.extend({ pool: poolSchema })).max(32),
  caller: sidecarSchema.shape.caller.extend({ pool: poolSchema }),
  nodes: z.array(sidecarSchema.shape.nodes.element.extend({ alive: z.boolean(), ready: z.boolean() })).min(3).max(11),
  balancer: sidecarSchema.shape.balancer.extend({ initial: z.enum(["eligible", "ineligible"]),
    healthTimeoutUs: time.positive(), healthKeys: z.array(id).min(1).max(128) }),
  workload: z.object({ scheduleHash: digest, parametersHash: digest, resolvedIdentity: digest, executedScheduleHash: digest }).strict().nullable(),
});

export const sidecarV3Schema = sidecarV2Schema.extend({
  faults: z.tuple([]), retry: z.never().optional(),
  links: z.array(sidecarV2Schema.shape.links.element).max(128),
  schema: z.literal("infraforge-first-stack-sidecar/3"), compiler: z.literal("first-stack-compiler/3"),
  cache: z.object({ node: id, semantics: z.literal("keyed-cache/1"), capacityBytes: amount, entryOverheadBytes: amount,
    ttlUs: time.positive(), commandCpuUs: time.positive(), policy: z.enum(["lru", "no-eviction"]),
    initial: sidecarSchema.shape.database.shape.initial, coalesce: z.boolean(), onFailure: z.enum(["fail", "database"]),
    invalidateWrites: z.literal(true), policyCpuUs: time.nullable(),
    roles: z.array(z.object({ app: id, policy: id, internal: sidecarV2Schema.shape.paths.element,
      database: sidecarV2Schema.shape.paths.element }).strict()).min(1).max(limits.apps) }).strict(),
});

export function reviewSidecar(layout: unknown, candidate: unknown) {
  const diagnostics: FirstStackDiagnostic[] = [];
  const refuse = (path: string, message: string, code = "FIRST_STACK_FIELD") => diagnostics.push({ code, path, message });
  const saved = LayoutSchema.safeParse(layout), parsed = z.discriminatedUnion("schema", [sidecarSchema, sidecarV2Schema, sidecarV3Schema]).safeParse(candidate);
  for (const result of [saved, parsed]) if (!result.success) for (const e of result.error.issues) refuse(e.path.join("."), e.message);
  if (!saved.success || !parsed.success) return { ok: false as const, diagnostics };
  const original = saved.data, sidecar: FirstStackSemantic = parsed.data;
  const cache = sidecar.schema === "infraforge-first-stack-sidecar/3" ? sidecar.cache : undefined;
  if (sidecar.designRevision !== designRevision(original)) refuse("designRevision", "Saved design changed; review its current immutable revision.", "STALE_REVISION");
  const unique = (values: string[], path: string) => { if (new Set(values).size !== values.length) refuse(path, "Duplicate identities refuse ambiguous bindings."); };
  unique(original.resources.map(n => n.id), "resources"); unique(original.connectionLines.map(e => e.id), "connectionLines");
  for (const field of ["nodes", "paths", "links", "placement", "operations"] as const) unique(sidecar[field].map(x => x.id), field);
  unique(sidecar.database.keys, "database.keys"); unique(sidecar.database.plans.map(p => p.id), "database.plans");
  if (sidecar.database.keys.some(key => Buffer.byteLength(key) > limits.keyBytes)) refuse("database.keys", "Key byte budget exceeded.");
  unique(sidecar.database.initial.map(r => r.key), "database.initial");
  for (const r of sidecar.database.initial) if (!sidecar.database.keys.includes(r.key)) refuse("database.initial", "Initial row outside the declared dataset.");
  const types = new Map(original.resources.map(n => [n.id, n.type]));
  const countType = (type: string) => original.resources.filter(n => n.type === type).length;
  if (countType("Load Balancer") !== 1 || countType("Database") !== 1 || countType("Virtual Machine") < 1 || countType("Virtual Machine") > limits.apps || countType("Cache") > 1) refuse("resources", "Require one LB, 1..8 apps, one DB and at most one future cache.", "FIRST_STACK_SCOPE");
  const owners: Record<string, string> = { "Load Balancer": "load-balancer", "Virtual Machine": "compute", Database: "relational", Cache: "keyed-cache" };
  for (const [i, n] of original.resources.entries()) {
    if (!owners[n.type]) refuse(`resources.${i}.type`, "Resource kind is unsupported.");
    if (n.type === "Cache" && !cache) refuse(`resources.${i}.type`, "Cache layout is retained; executable cache review requires the later cache bridge.", "CACHE_DEFERRED");
    const binding = sidecar.nodes.find(s => s.id === n.id);
    if (!binding || binding.owner !== owners[n.type]) refuse(`nodes.${n.id}`, "Supply the matching explicit semantic owner.");
    for (const [key, value] of Object.entries(n)) {
      if (["id", "type", "name", "x", "y", "skuId", "region", "size"].includes(key)) continue;
      if ((key === "autoscaling" && JSON.stringify(value) === '{"enabled":false}') || (["public", "encryption"].includes(key) && value === false) || (key === "openPorts" && Array.isArray(value) && !value.length)) continue;
      refuse(`resources.${i}.${key}`, "Preserved setting has no first-stack execution owner; supply an explicit replacement.");
    }
  }
  for (const key of Object.keys(original)) if (!["resources", "connectionLines", "layoutVersion", "firstStack"].includes(key)) refuse(key, "Preserved layout extension has no execution owner.");
  for (const n of sidecar.nodes) if (!types.has(n.id)) refuse(`nodes.${n.id}`, "Owner has no canvas resource.");
  const hosts = new Map(sidecar.placement.map(h => [h.id, h]));
  for (const n of sidecar.nodes) {
    const h = hosts.get(n.host), peers = sidecar.nodes.filter(p => p.host === n.host);
    if (!h || h.cores !== n.cores) refuse(`nodes.${n.id}.host`, "Explicit host and matching CPU capacity are required.");
    if (h && peers.length > 1 && (h.memoryBytes === null || peers.some(p => p.reservationBytes === null))) refuse(`placement.${n.host}`, "Shared-host reservations cannot treat Unknown as zero.");
    if (h?.memoryBytes !== null && h && peers.every(p => p.reservationBytes !== null) && peers.reduce((s, p) => s + p.reservationBytes!, 0) > h.memoryBytes) refuse(`placement.${n.host}.memoryBytes`, "Known reservations exceed capacity.");
  }
  for (const h of sidecar.placement) if (!sidecar.nodes.some(n => n.host === h.id)) refuse(`placement.${h.id}`, "Unowned host.");
  const lb = original.resources.find(n => n.type === "Load Balancer")?.id, db = original.resources.find(n => n.type === "Database")?.id;
  const apps = original.resources.filter(n => n.type === "Virtual Machine").map(n => n.id);
  if (sidecar.caller.entry !== lb || sidecar.nodes.find(n => n.id === lb)?.listenerPort !== sidecar.caller.port) refuse("caller", "Explicit caller entry and port must match the LB listener.");
  for (const link of [sidecar.caller.requestLink, sidecar.caller.responseLink]) if (!sidecar.links.some(l => l.id === link)) refuse("caller", "Missing caller directed link owner.");
  if (sidecar.caller.requestBytes === null || sidecar.caller.responseBytes === null) refuse("caller", "Unknown caller bytes require explicit mapping.");
  const wanted = new Set(apps.flatMap(app => [JSON.stringify([lb, app]), JSON.stringify([app, db]), ...(cache ? [JSON.stringify([app, cache.node])] : [])]));
  const edges = new Set<string>();
  for (const [i, edge] of original.connectionLines.entries()) {
    const pair = JSON.stringify([edge.sourceId, edge.targetId]);
    if (!wanted.has(pair) || edges.has(pair)) refuse(`connectionLines.${i}`, "Ambiguous or unsupported directed path.");
    edges.add(pair);
    if (edge.sourceType !== types.get(edge.sourceId) || edge.targetType !== types.get(edge.targetId)) refuse(`connectionLines.${i}`, "Endpoint type does not match its owner.");
    for (const key of Object.keys(edge)) if (!["id", "sourceId", "targetId", "sourceType", "targetType", "port"].includes(key)) refuse(`connectionLines.${i}.${key}`, "Unowned edge setting.");
    const p = sidecar.paths.find(p => p.id === edge.id);
    if (!p || p.source !== edge.sourceId || p.target !== edge.targetId || p.port !== edge.port || p.port !== sidecar.nodes.find(n => n.id === edge.targetId)?.listenerPort || p.purpose !== (edge.sourceId === lb ? "routing" : "dependency")) refuse(`paths.${edge.id}`, "Supply matching directed transport, listener port and purpose.");
  }
  if (edges.size !== wanted.size || [...wanted].some(e => !edges.has(e))) refuse("connectionLines", "Each app needs LB routing and DB dependency edges.");
  for (const p of sidecar.paths) {
    if (!original.connectionLines.some(e => e.id === p.id)) refuse(`paths.${p.id}`, "Transport has no canvas edge.");
    for (const link of [p.requestLink, p.responseLink]) if (!sidecar.links.some(l => l.id === link)) refuse(`paths.${p.id}`, "Missing explicit directed link owner.");
    if (p.requestBytes === null || p.responseBytes === null) refuse(`paths.${p.id}`, "Supply explicit request/return byte mapping; Unknown is not zero.");
  }
  const health = sidecar.operations.find(o => o.id === sidecar.balancer.healthOperation);
  if (health?.kind !== "health-read") refuse("balancer.healthOperation", "A separately identified DB-backed read-only health operation is required.");
  const plans = new Map(sidecar.database.plans.map(p => [p.id, p]));
  for (const [i, op] of sidecar.operations.entries()) {
    const p = plans.get(op.plan);
    if (!p) refuse(`operations.${i}.plan`, "Unknown finite plan.");
    if (op.kind === "cache-read" && !cache) refuse(`operations.${i}.kind`, "Cache bridge is deferred.");
    if (p && ["point-read", "range-read", "health-read", "cache-read"].includes(op.kind) && p.kind !== "read") refuse(`operations.${i}.plan`, "Read operations require read-only plans.");
    if (p && ["update", "hot-update"].includes(op.kind) && p.kind !== "write") refuse(`operations.${i}.plan`, "Update operations require write plans.");
  }
  for (const p of plans.values()) if (p.keys !== "recorded" && p.keys.some(k => !sidecar.database.keys.includes(k))) refuse(`database.plans.${p.id}.keys`, "Plan key outside the finite dataset.");
  if (sidecar.schema !== "infraforge-first-stack-sidecar/1") {
    const used = new Set<string>();
    for (const p of [{ ...sidecar.caller, id: "$caller", source: "$caller", target: sidecar.caller.entry }, ...sidecar.paths, ...(cache ? cache.roles.flatMap(r => [r.internal, r.database]) : [])]) {
      for (const [linkId, from, to] of [[p.requestLink, p.source, p.target], [p.responseLink, p.target, p.source]]) {
        used.add(linkId!);
        const l = sidecar.links.find(l => l.id === linkId);
        if (!l || l.from !== from || l.to !== to) refuse(`paths.${p.id}`, `Link ${linkId} must explicitly run ${from} → ${to}.`, "DIRECTED_LINK");
      }
      if (p.timeoutUs !== p.pool.responseTimeoutUs) refuse(`paths.${p.id}.timeoutUs`, "Match the explicit pool response timeout; conflicting policies cannot be compiled.");
    }
    for (const l of sidecar.links) if (!used.has(l.id)) refuse(`links.${l.id}`, "Remove the unowned link or bind it to an explicit path.");
    const healthPlan = health && plans.get(health.plan);
    if (new Set(sidecar.balancer.healthKeys).size !== sidecar.balancer.healthKeys.length || sidecar.balancer.healthKeys.some(k => !sidecar.database.keys.includes(k)) ||
      (healthPlan?.keys !== "recorded" && JSON.stringify(healthPlan?.keys) !== JSON.stringify(sidecar.balancer.healthKeys))) refuse("balancer.healthKeys", "Supply exact finite health keys matching the read-only health plan.");
    if (sidecar.balancer.healthTimeoutUs > sidecar.balancer.intervalUs) refuse("balancer.healthTimeoutUs", "Overlapping health probes are unsupported; timeout must not exceed interval.");
  }
  if (cache) {
    if (types.get(cache.node) !== "Cache" || countType("Cache") !== 1) refuse("cache.node", "V3 requires one matching cache canvas owner.");
    unique(cache.initial.map(r => r.key), "cache.initial");
    for (const row of cache.initial) if (!sidecar.database.keys.includes(row.key) || row.version < 1) refuse("cache.initial", "Initial cache keys/versions must belong to the bounded dataset.");
    if (cache.initial.reduce((sum, r) => sum + r.bytes + cache.entryOverheadBytes, 0) > cache.capacityBytes) refuse("cache.initial", "Initial entries exceed the explicit cache entry budget.");
    unique(cache.roles.map(r => r.app), "cache.roles");
    unique([...sidecar.paths.map(p => p.id), ...cache.roles.flatMap(r => [r.internal.id, r.database.id])], "cache.paths");
    if (cache.roles.length !== apps.length) refuse("cache.roles", "Exactly one owned policy per app required.");
    for (const r of cache.roles) {
      if (!apps.includes(r.app) || r.policy !== `${r.app}/cache-policy` || types.has(r.policy)) refuse("cache.roles", "Explicit app/cache-policy ownership required.");
      if (r.internal.source !== r.app || r.internal.target !== r.policy || r.database.source !== r.policy || r.database.target !== db ||
        r.internal.purpose !== "dependency" || r.database.purpose !== "dependency" || r.database.port !== sidecar.nodes.find(n => n.id === db)?.listenerPort ||
        r.internal.requestBytes === null || r.internal.responseBytes === null || r.database.requestBytes === null || r.database.responseBytes === null) refuse("cache.roles", "Explicit known compute/policy/DB paths required.");
    }
    for (const op of sidecar.operations.filter(o => o.kind === "cache-read" || ["update", "hot-update"].includes(o.kind))) {
      if (plans.get(op.plan)?.keys !== "recorded") refuse(`operations.${op.id}`, "Cache and invalidating writes require the exact recorded point key.");
    }
  }
  return diagnostics.length ? { ok: false as const, diagnostics } : { ok: true as const, diagnostics, sidecar,
    claims: firstStackClaims, executable: false as const,
    unknown: ["Full resident memory", "Full cost", "Physical timing calibration", ...(apps.length === 1 ? ["Single app: no application redundancy"] : [])] };
}
