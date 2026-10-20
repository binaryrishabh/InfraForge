import type { FirstStackExecutable, ResolvedSchedule } from "@infraforge/contracts/first-stack";
import type { DataInput, TransactionPlan } from "../model2/data/contracts";
import type { ComputeProfile, ComputeResource } from "../model2/compute/contracts";
import type { PathConfig } from "../model2/network/contracts";
import type { StackComposition } from "../model2/composition/run";
import type { RealityEntry } from "../reality/ledger";
import type { Quantity, Unit } from "../reality/quantity";
import { validateData } from "../model2/data/validate";
import { FIRST_STACK_ENVELOPE as envelope, firstStackPreflight, refuse } from "./bounds";
import { compileScenario } from "./faults";
import { lexical } from "../model2/time";

export const COMPOSITION_REVISION = "first-stack-composition/2";
export { FirstStackCompileRefusal, refuse } from "./bounds";

// Trusted typed boundary: backend review validates the complete V2 sidecar and
// verifies workload identities before this compiler is called. No legacy cast.
export function compileFirstStack(sidecar: FirstStackExecutable, schedule: ResolvedSchedule, policy: {
  seed: string; horizonUs: number; sampleIntervalUs: number; maxEvents: number; maxSamples: number; maxRawResults: number;
}) {
  if (!((sidecar.schema === "infraforge-first-stack-sidecar/2" && sidecar.compiler === "first-stack-compiler/2") || (sidecar.schema === "infraforge-first-stack-sidecar/3" && sidecar.compiler === "first-stack-compiler/3"))) refuse("schema", "Supply a reviewed V2 copy with directed links, pool and readiness policy; V1 cannot execute.");
  const cache = sidecar.schema === "infraforge-first-stack-sidecar/3" ? sidecar.cache : undefined;
  const revision = cache ? "first-stack-composition/3" : COMPOSITION_REVISION;
  const nodes = [...sidecar.nodes].sort((a, b) => lexical(a.id, b.id)), apps = nodes.filter(n => n.owner === "compute");
  const lb = nodes.find(n => n.owner === "load-balancer"), db = nodes.find(n => n.owner === "relational");
  if (!lb || !db || apps.length < 1 || apps.length > 8 || nodes.length !== apps.length + 2 + (cache ? 1 : 0) || nodes.filter(n => n.owner === "keyed-cache").length !== (cache ? 1 : 0)) refuse("nodes", "Require exactly one LB, 1..8 compute apps and one relational DB and the explicitly versioned optional cache.");
  if (sidecar.database.keys.includes("$key")) refuse("database.keys", "The literal key $key is reserved by Stage 1 parameter substitution; choose a different explicit dataset key.", "RESERVED_KEY");
  if (lb.reservationBytes !== 0) refuse(`nodes.${lb.id}.reservationBytes`, "The logical LB has no CPU/memory demand owner in Stage 1; explicitly author zero reservation for that role. Full LB process memory remains Unknown.");
  for (const n of nodes) if (n.memoryBytes !== null) refuse(`nodes.${n.id}.memoryBytes`, "Full process memory coverage is unavailable; keep this Unknown and supply the separate explicit host reservation.");
  if (schedule.header.durationUs > policy.horizonUs) refuse("horizonUs", "The execution horizon must cover the recorded offer duration.");
  if (policy.horizonUs > 300_000_000 || schedule.rows.length > 20_000 || policy.maxEvents > 2_000_000) refuse("policy", "Exceeds the internal first-stack software envelope; reduce horizon, rows or events.");
  firstStackPreflight(sidecar, schedule, policy);
  const health = sidecar.operations.find(o => o.id === sidecar.balancer.healthOperation)!;
  const operations = [...sidecar.operations].sort((a, b) => lexical(a.id, b.id));
  if (!health || health.kind !== "health-read") refuse("balancer.healthOperation", "Supply a separately identified DB-backed health read.");
  for (const op of operations) {
    if (op.kind === "cpu-control" || (op.kind === "cache-read" && !cache)) refuse(`operations.${op.id}`, "This revision composes DB-backed work only; CPU-only and cache policy need an operation-specific dependency revision.", "OPERATION_UNSUPPORTED");
    if (op.cpuUs + op.blockingUs <= 0) refuse(`operations.${op.id}`, "Stage 1 compute service must advance virtual time; supply explicit positive demand.");
    if (op.requestBytes === null || op.responseBytes === null) refuse(`operations.${op.id}`, "Supply explicit operation byte mappings; Unknown cannot enter transport.", "UNKNOWN_BYTES");
  }
  for (const row of schedule.rows) {
    const op = operations.find(o => o.id === row.operation);
    if (!op || op.id === health.id || row.plan !== op.plan || row.deadlineUs !== op.deadlineUs) refuse(`rows.${row.id}`, "Match a reviewed foreground operation, plan and deadline; health is background work only.");
    if (row.requestBytes !== op.requestBytes || row.responseBytes !== op.responseBytes) refuse(`rows.${row.id}`, "Stage 1 caller transport requires fixed bytes per operation; split this byte class into an explicit reviewed operation.", "VARIABLE_BYTES_UNSUPPORTED");
  }
  const ledger: RealityEntry[] = [];
  const q = <U extends Unit>(path: string, value: number | null, unit: U): Quantity<U> => {
    if (value === null || !Number.isFinite(value)) return refuse(path, `Supply a known ${unit} value; Unknown is not zero.`, "UNKNOWN_INPUT");
    const id = `first-stack.${path}`;
    const quantity: Quantity<U> = { kind: "known", value, unit, provenance: [id] };
    ledger.push({ id, concept: path, modelVersion: "2", scope: revision, validityDomain: sidecar.application.workloadDomain,
      quantity, formula: "Explicit reviewed input or compiler policy constant", classification: "user-input", confidence: "conditional",
      provenance: sidecar.sources.map(source => ({ source, supports: "implementation", detail: "Reviewed conditional composition input; not cloud calibration" })),
      assumptions: ["All composed timing remains assumption-only; full resident memory and cost remain Unknown"],
      researchedOn: "2026-10-20", freeMode: "forbidden", replacement: "Review a new immutable compiler/input revision" });
    return quantity;
  };
  const context = { labels: { application: sidecar.application.id, runtime: sidecar.application.runtime, hardware: sidecar.application.hardware }, quantities: {} };
  const profiles: ComputeProfile[] = operations.map(op => ({ schema: "infraforge-compute-demand/1", id: op.id, version: sidecar.application.version,
    application: sidecar.application.id, operation: op.id, stage: "compute", method: sidecar.application.origin === "measured" ? "measured" : "synthetic",
    cpu: q(`operations.${op.id}.cpu`, op.cpuUs + (cache && (op.kind === "cache-read" || ["update", "hot-update"].includes(op.kind)) ? cache.policyCpuUs ?? 0 : 0), "cpu-us"), blockingWait: q(`operations.${op.id}.blocking`, op.blockingUs, "us"),
    maxCpuParallelism: q(`operations.${op.id}.parallelism`, op.parallelism, "cores"), residentCoverage: "partial",
    ...(op.residentBytes === null ? {} : { requestResidentBytes: q(`operations.${op.id}.resident`, op.residentBytes, "bytes") }),
    obtainedBy: `Reviewed ${sidecar.application.origin} demand ${sidecar.application.id}/${sidecar.application.version}`,
    evidence: sidecar.application.sources, date: "2026-10-20", validity: { exact: context.labels, ranges: {} },
    uncertainty: ["Compiler transcription date is not a measurement date; composed timing is assumption-only", ...(sidecar.application.measurement ? [sidecar.application.measurement.uncertainty] : [])], freeMode: "forbidden" }));
  const computeConfigs = new Map<string, ComputeResource>();
  const compute = (n: typeof nodes[number]): ComputeResource => {
    const old = computeConfigs.get(n.id); if (old) return old;
    const value: ComputeResource = { id: n.id, kind: "compute", cores: q(`nodes.${n.id}.cores`, n.cores, "cores"),
    workers: q(`nodes.${n.id}.workers`, n.workers, "count"), queueCapacity: q(`nodes.${n.id}.queue`, n.queue, "count"),
    profiles: Object.fromEntries(operations.map(op => [op.id, op.id])), context,
    cancellation: n.cancellation === "detach" ? "unsupported" : "cooperative", scheduler: "capped-equal-fluid/1",
    memory: { coverage: "partial", policy: "observe" } };
    computeConfigs.set(n.id, value); return value;
  };
  const plans: Record<string, TransactionPlan> = {};
  for (const op of operations) {
    const plan = sidecar.database.plans.find(p => p.id === op.plan);
    if (!plan) refuse(`operations.${op.id}.plan`, "Supply a finite database plan.");
    let keys: string[];
    if (plan.keys !== "recorded") keys = plan.keys;
    else if (op.id === health.id) keys = sidecar.balancer.healthKeys;
    else if (op.kind === "range-read") {
      const rows = schedule.rows.filter(r => r.operation === op.id);
      if (!rows.length || rows.some(r => JSON.stringify(r.keys) !== JSON.stringify(rows[0]!.keys))) refuse(`operations.${op.id}.plan`, "Stage 1 range statements need one explicit key list; split differing ranges into reviewed plans.", "VARIABLE_RANGE_UNSUPPORTED");
      keys = rows[0]!.keys;
    } else keys = ["$key"];
    plans[op.id] = { statements: [{ kind: plan.kind === "read" ? "snapshot-read" : "write", keys,
      cpu: q(`plans.${op.id}.cpu`, plan.cpuUs, "cpu-us"), parallelism: q(`plans.${op.id}.parallelism`, plan.parallelism, "cores"),
      blockingWait: q(`plans.${op.id}.blocking`, plan.blockingUs, "us"), logBytes: q(`plans.${op.id}.log`, plan.logBytes, "bytes") }],
      statementTimeout: q(`plans.${op.id}.statementTimeout`, plan.statementTimeoutUs, "us"), lockTimeout: q(`plans.${op.id}.lockTimeout`, plan.lockTimeoutUs, "us"),
      transactionTimeout: q(`plans.${op.id}.transactionTimeout`, plan.transactionTimeoutUs, "us"), commitWait: q(`plans.${op.id}.commitWait`, plan.commitWaitUs, "us"), durability: plan.durability };
  }
  const path = (p: FirstStackExecutable["paths"][number]): PathConfig => ({ id: p.id, source: p.source, target: p.target, request: [p.requestLink], response: [p.responseLink],
    pool: { mode: "serial", streams: q(`paths.${p.id}.streams`, 1, "count"), reuse: p.pool.reuse,
      maxConnections: q(`paths.${p.id}.connections`, p.connections, "count"), pending: q(`paths.${p.id}.pending`, p.pending, "count"),
      establish: q(`paths.${p.id}.establish`, p.pool.establishUs, "us"), acquireTimeout: q(`paths.${p.id}.acquireTimeout`, p.pool.acquireTimeoutUs, "us"),
      connectTimeout: q(`paths.${p.id}.connectTimeout`, p.pool.connectTimeoutUs, "us"), responseTimeout: q(`paths.${p.id}.responseTimeout`, p.pool.responseTimeoutUs, "us"),
      ...(p.pool.idleTimeoutUs === null ? {} : { idleTimeout: q(`paths.${p.id}.idleTimeout`, p.pool.idleTimeoutUs, "us") }), remoteCancellation: p.pool.remoteCancellation },
    // Recorded bytes are the application message body; each explicit path's
    // authored bytes are its envelope. Both are charged once on every hop.
    bytes: Object.fromEntries(operations.map(op => [op.id, {
      request: q(`paths.${p.id}.${op.id}.request`, p.requestBytes === null ? null : p.requestBytes + op.requestBytes!, "bytes"),
      response: q(`paths.${p.id}.${op.id}.response`, p.responseBytes === null ? null : p.responseBytes + op.responseBytes!, "bytes") }])) });
  const composition: StackComposition = {
    hosts: [...sidecar.placement].sort((a, b) => lexical(a.id, b.id)).map(h => ({ id: h.id, cores: q(`hosts.${h.id}.cores`, h.cores, "cores"), memory: q(`hosts.${h.id}.memory`, h.memoryBytes, "bytes") })),
    bindings: nodes.filter(n => n.owner !== "load-balancer").map(n => ({ resource: n.id, host: n.host, reservedMemory: q(`nodes.${n.id}.reservation`, n.reservationBytes, "bytes") })),
  };
  const input: DataInput = { modelVersion: "2", workloadVersion: "m2e/1", seed: policy.seed, ledger, profiles,
    resources: [...apps.map(n => cache ? ({ ...compute(n), downstreamByOperation: Object.fromEntries(operations.map(op => [op.id, op.kind === "cache-read" || ["update", "hot-update"].includes(op.kind) ? cache.roles.find(r => r.app === n.id)!.policy : db.id])) }) : ({ ...compute(n), downstream: db.id })), { id: db.id, kind: "relational", semantics: sidecar.database.semantics,
      execution: compute(db), maxSessions: q("database.sessions", sidecar.database.maxSessions, "count"), activeTransactions: q("database.active", sidecar.database.activeTransactions, "count"),
      pendingQueries: q("database.pending", sidecar.database.pendingQueries, "count"), keys: [...sidecar.database.keys].sort(lexical),
      initial: [...sidecar.database.initial].sort((a, b) => lexical(a.key, b.key)).map(r => ({ ...r, bytes: q(`database.initial.${r.key}.bytes`, r.bytes, "bytes") })), plans },
    { id: lb.id, kind: "load-balancer", backends: apps.map(n => n.id), policy: sidecar.balancer.policy,
      maxOutstanding: q("lb.outstanding", sidecar.balancer.outstanding, "count"), maxPending: q("lb.pending", sidecar.balancer.pending, "count"), pendingTimeout: q("lb.timeout", sidecar.balancer.timeoutUs, "us"),
      health: { initial: sidecar.balancer.initial, interval: q("lb.health.interval", sidecar.balancer.intervalUs, "us"), timeout: q("lb.health.timeout", sidecar.balancer.healthTimeoutUs, "us"),
        healthy: q("lb.health.healthy", sidecar.balancer.healthy, "count"), unhealthy: q("lb.health.unhealthy", sidecar.balancer.unhealthy, "count"), operation: health.id } }],
    operations: operations.map(op => ({ id: op.id, entry: lb.id, callerTimeout: q(`operations.${op.id}.deadline`, op.deadlineUs, "us"),
      onCallerStop: sidecar.caller.pool.remoteCancellation, idempotency: ["update", "hot-update"].includes(op.kind) ? "non-idempotent" : "read-only" })),
    arrivals: [{ id: "recorded", kind: "trace", trace: { schema: "infraforge-arrivals/1", unit: "us", durationUs: schedule.header.durationUs,
      provenance: schedule.header.provenance, rows: schedule.rows.map(({ id, atUs, operation }) => ({ id, atUs, operation })) } }],
    links: [...sidecar.links].sort((a, b) => lexical(a.id, b.id)).map(l => ({ id: l.id, from: l.from, to: l.to, policy: "fifo-message/1",
      bandwidth: q(`links.${l.id}.bandwidth`, l.bytesPerSecond, "bytes/s"), propagation: q(`links.${l.id}.latency`, l.latencyUs, "us"), bufferBytes: q(`links.${l.id}.queue`, l.queueBytes, "bytes") })),
    paths: [{ ...sidecar.caller, id: "$caller", source: "$caller", target: lb.id, purpose: "routing" as const }, ...sidecar.paths].sort((a, b) => lexical(a.id, b.id)).map(path),
    endpoints: Object.fromEntries(nodes.map(n => [n.id, { alive: n.alive, ready: n.ready }])),
    faults: [], interventions: [], networkInterventions: [], dataInterventions: [],
    horizon: q("policy.horizon", policy.horizonUs, "us"), sampleInterval: q("policy.sample", policy.sampleIntervalUs, "us"),
    limits: { maxEvents: policy.maxEvents, maxSamples: policy.maxSamples, maxRequests: Math.max(1, schedule.rows.length), maxRawResults: policy.maxRawResults, maxTraceRows: Math.max(1, schedule.rows.length),
      maxPendingEvents: envelope.pendingEvents, maxLiveCalls: envelope.liveCalls, maxRetainedSamples: envelope.retainedSamples,
      maxSampleBytes: envelope.sampleBytes, maxRawBytes: envelope.rawBytes, maxGroups: envelope.operations * 4, maxTraceBytes: envelope.rawBytes } };
  if (cache) {
    const node = nodes.find(n => n.id === cache.node && n.owner === "keyed-cache");
    if (!node || cache.roles.length !== apps.length || new Set(cache.roles.map(r => r.app)).size !== apps.length) refuse("cache.roles", "One explicit policy role per app and one cache owner required.");
    input.resources.push({ id: node.id, kind: "cache", semantics: cache.semantics, execution: compute(node),
      capacity: q("cache.capacity", cache.capacityBytes, "bytes"), entryOverhead: q("cache.overhead", cache.entryOverheadBytes, "bytes"),
      ttl: q("cache.ttl", cache.ttlUs, "us"), commandCpu: q("cache.cpu", cache.commandCpuUs, "cpu-us"), policy: cache.policy,
      initial: cache.initial.map(r => ({ ...r, bytes: q(`cache.initial.${r.key}.bytes`, r.bytes, "bytes") })) });
    for (const role of cache.roles) {
      const app = apps.find(n => n.id === role.app);
      if (!app || role.policy !== `${app.id}/cache-policy` || input.resources.some(r => r.id === role.policy) || role.internal.source !== app.id || role.internal.target !== role.policy) refuse("cache.roles", "Use the owned app/cache-policy identity and explicit compute-to-policy path.");
      input.resources.push({ id: role.policy, kind: "cache-aside", execution: { ...compute(app), id: role.policy },
        recordedKeysOnly: true, cache: node.id, database: db.id, keys: [...sidecar.database.keys], access: "cycle",
        coalesce: cache.coalesce, onCacheFailure: cache.onFailure, invalidateWrites: cache.invalidateWrites,
        operations: Object.fromEntries(operations.map(op => [op.id, ["update", "hot-update"].includes(op.kind) ? "write" : "read"])) });
      input.endpoints[role.policy] = { alive: app.alive, ready: app.ready };
      const edge = sidecar.paths.find(p => p.source === app.id && p.target === node.id);
      if (!edge || role.database.source !== role.policy || role.database.target !== db.id) refuse("cache.paths", "Explicit policy cache/DB paths required.");
      const mapped = input.paths.find(p => p.id === edge.id)!; mapped.source = role.policy;
      for (const link of input.links.filter(l => [edge.requestLink, edge.responseLink].includes(l.id))) {
        if (link.from === app.id) link.from = role.policy;
        if (link.to === app.id) link.to = role.policy;
      }
      input.paths.push(path(role.internal), path(role.database));
    }
  }
  if (sidecar.schema === "infraforge-first-stack-sidecar/2") compileScenario(sidecar, input, composition, q);
  else if (sidecar.faults.length || sidecar.retry) refuse("faults", "Cache plus faults or retries requires a separately reviewed composition revision.");
  input.resources.sort((a, b) => lexical(a.id, b.id)); ledger.sort((a, b) => lexical(a.id, b.id));
  try { validateData(input); } catch (e) { refuse("stage1", `Stage 1 refused this composition: ${e instanceof Error ? e.message : String(e)}. Review the named demand, transport or budget field.`); }
  return { revision, input, composition };
}

export type FirstStackExecutionPolicy = Parameters<typeof compileFirstStack>[2];
export type CompiledFirstStack = ReturnType<typeof compileFirstStack>;
