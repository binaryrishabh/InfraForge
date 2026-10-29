import { findSku, CATALOG_SNAPSHOT_DATE } from "@infraforge/catalog";
import { RESOURCE_PORTS, retrySettingsError, type Resource } from "@infraforge/domain/resource";
import type { Quantity, Unit } from "../../reality/quantity";
import type { ComputeResource } from "../compute/contracts";
import type { CommandConfig } from "../async/contracts";
import type { ProductContract, SavedProductDesign, Diagnostic, ResourceTemplate, EdgeContract } from "./contracts";
import { compileProduct, savedPoolPolicies } from "./compiler";
import { boundedProduct } from "./bounds";
import { canonical } from "./provenance";

export interface Assumption { id: string; value: unknown; unit: string; sentence: string }
const SOURCE = "packages/simulation/src/model2/product/fromDesign.ts";
const SCOPE = "Assumed educational workload; no measured application or provider performance";
const operations = ["read", "write", "health"] as const;

/** Canvas intent is preserved; missing application and service settings are visible assumptions. */
export function contractFromDesign(saved: SavedProductDesign): { contract: ProductContract; assumptions: Assumption[] } | { refused: Diagnostic[] } {
  const refused: Diagnostic[] = [];
  const error = (path: string, message: string) => refused.push({ code: "DESIGN_NOT_RUNNABLE", path, message, severity: "error" });
  try {
    boundedProduct(saved);
    const design = savedPoolPolicies(saved), resources = [...design.resources].sort((a, b) => a.id < b.id ? -1 : 1);
    const byId = new Map(resources.map((r) => [r.id, r]));
    const connections = [...design.connections].sort((a, b) => a.id < b.id ? -1 : 1);
    const outgoing = (id: string) => connections.filter((e) => e.sourceId === id).map((e) => byId.get(e.targetId)!);
    const incoming = (id: string) => connections.filter((e) => e.targetId === id).map((e) => byId.get(e.sourceId)!);
    if (!resources.length) error("resources", "Add an app server or a CDN before running this empty canvas.");
    if (resources.some((r) => !/^[a-zA-Z0-9_-]{1,64}$/.test(r.id)) || byId.size !== resources.length) error("resources", "Give every resource a unique ID containing only letters, numbers, dashes or underscores.");
    for (const e of connections) if (!byId.has(e.sourceId) || !byId.has(e.targetId) || e.sourceId === e.targetId) error(`connections.${e.id}`, "Connect two different resources that both exist on the canvas.");
    if (refused.length) return { refused };
    for (const r of resources) {
      const retryError = retrySettingsError(r.type, r.retry);
      if (retryError) error(`resources.${r.id}.retry`, retryError);
      if (!(r.type in RESOURCE_PORTS)) error(`resources.${r.id}`, "This resource type has no Model 2 profile.");
      if (r.skuId && findSku(r.skuId)?.category !== r.type) error(`resources.${r.id}.skuId`, "Choose a catalog size belonging to this resource type.");
      if (r.type === "Database" && !incoming(r.id).some((s) => ["Virtual Machine", "Cache"].includes(s.type))) error(`resources.${r.id}`, "Connect an app server or a cache to this database so something can call it.");
      if (r.type === "Load Balancer" && (!outgoing(r.id).length || outgoing(r.id).some((t) => t.type !== "Virtual Machine"))) error(`resources.${r.id}`, "Connect the load balancer to at least one app server.");
      if (["CDN", "Container Registry", "DNS"].includes(r.type) && outgoing(r.id).length !== 1) error(`resources.${r.id}`, "Connect this resource to exactly one object store or entry point as appropriate.");
      if (r.type === "Cache" && (outgoing(r.id).length > 1 || (!outgoing(r.id).length && !incoming(r.id).some((s) => s.type === "Virtual Machine" && outgoing(s.id).some((t) => t.type === "Database"))))) error(`resources.${r.id}`, "Connect the cache to one database, or connect both the cache and a database to its app server.");
      if (r.type === "Monitoring Agent" && !outgoing(r.id).length) error(`resources.${r.id}`, "Connect the monitoring agent to a resource to observe.");
      if (r.autoscaling?.enabled && (r.type !== "Virtual Machine" || incoming(r.id).filter((s) => s.type === "Load Balancer").length !== 1)) error(`resources.${r.id}.autoscaling`, "Autoscaling needs an app server behind exactly one load balancer.");
    }
    const entries = resources.filter((r) => ["Load Balancer", "CDN", "Virtual Machine"].includes(r.type) && !incoming(r.id).some((s) => ["Load Balancer", "Virtual Machine", "CDN"].includes(s.type)));
    if (entries.length !== 1) error("caller.entry", "Connect the design into one entry point: one load balancer, CDN or app server.");
    const connected = new Set<string>(), visit = (id: string): void => { if (connected.has(id)) return; connected.add(id); for (const r of [...outgoing(id), ...incoming(id)]) visit(r.id); };
    if (entries[0]) visit(entries[0].id);
    for (const r of resources) if (!connected.has(r.id)) error(`resources.${r.id}`, "Connect this resource to the application's graph before running it.");
    if (refused.length) return { refused };
    const entry = entries[0]!, assumptions: Assumption[] = [], ledger: ProductContract["ledger"] = [];
    const note = <T>(id: string, value: T, unit: string, sentence: string): T => { assumptions.push({ id, value, unit, sentence }); return value; };
    const q = <U extends Unit>(id: string, value: number, unit: U, sentence = `The assumed ${id.replaceAll(".", " ")} is ${value} ${unit}.`, chosen = false): Quantity<U> => {
      const quantity: Quantity<U> = { kind: "known", value, unit, provenance: [id] };
      if (!chosen) note(id, value, unit, sentence);
      ledger.push({ id, concept: id, modelVersion: "2", scope: SCOPE, validityDomain: SCOPE, quantity, formula: String(value), classification: chosen ? "user-input" : "educational-assumption", confidence: "conditional", provenance: [{ source: chosen ? `saved-design:${id}` : SOURCE, supports: "implementation", detail: sentence }], assumptions: [chosen ? "Saved setting only; no physical accuracy claim." : sentence], researchedOn: "2026-10-27", freeMode: "forbidden", replacement: "Replace with measured application settings before claiming physical accuracy." });
      return quantity;
    };
    const nodes: ProductContract["nodes"] = Object.create(null), edges: ProductContract["edges"] = Object.create(null);
    const capabilities: ProductContract["capabilities"] = [];
    const cores = new Map<string, number>(), memory = new Map<string, number>();
    for (const r of resources) {
      const sku = r.skuId ? findSku(r.skuId)! : undefined, scale = { small: 1, medium: 2, large: 4 }[r.size ?? "small"];
      cores.set(r.id, sku?.vCpu ?? scale); memory.set(r.id, sku?.ramGb ?? scale * 2);
      note(`${r.id}.sizing`, { cores: cores.get(r.id), memoryGb: memory.get(r.id) }, "profile", sku ? "Catalog CPU and memory labels size this assumed profile; they do not establish effective capacity." : "Small, medium and large assume one, two and four cores with two GB per core; an omitted size uses small.");
      if (sku) {
        // Advertised CPU counts only; execution capacity below remains an explicit assumption.
        const source = sku.provider === "aws" ? sku.category === "Database" ? "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.DBInstanceClass.Summary.html" : `https://docs.aws.amazon.com/ec2/latest/instancetypes/${sku.skuId.startsWith("c") ? "co" : sku.skuId.startsWith("r") ? "mo" : "gp"}.html` : sku.category === "Database" ? "https://www.digitalocean.com/pricing/managed-databases" : "https://www.digitalocean.com/pricing/droplets";
        const id = `${r.id}.catalog.vCpu`, value = q(id, sku.vCpu, "count", "The selected catalog advertises this vCPU count; effective CPU remains assumed.", true), fact = ledger.at(-1)!;
        Object.assign(fact, { concept: `${sku.skuId} vCpu`, scope: `${sku.skuId} advertised vCPU only`, classification: "provider-fact", provenance: [{ source, supports: "exact", detail: "Advertised vCPU count, excluding credits, price, timing and effective CPU." }] });
        capabilities.push({ resource: r.id, sku: sku.skuId, catalogVersion: CATALOG_SNAPSHOT_DATE, field: "vCpu", value, fact: id });
      }
    }
    const execution = (r: Resource, role: string): ComputeResource => {
      const id = `${r.id}.${role}`;
      return { id, kind: "compute", cores: q(`${id}.cores`, cores.get(r.id)!, "cores"), workers: q(`${id}.workers`, cores.get(r.id)! * 4, "count"), scheduler: "capped-equal-fluid/1", queueCapacity: q(`${id}.queue`, 256, "count"), profiles: Object.fromEntries(operations.map((o) => [o, `canvas.${o}`])), context: { labels: { environment: "canvas-assumptions" }, quantities: {} }, cancellation: "cooperative", memory: { coverage: "partial", policy: "observe" } };
    };
    const command = (r: Resource, role: string, names: string[]): CommandConfig => {
      const id = `${r.id}.${role}`;
      return { execution: execution(r, role), concurrency: q(`${id}.concurrency`, 16, "count"), pending: q(`${id}.pending`, 256, "count"), timeout: q(`${id}.timeout`, 1000000, "us"), demands: Object.fromEntries(names.map((n) => [n, { cpu: q(`${id}.${n}.cpu`, 100, "cpu-us"), wait: q(`${id}.${n}.wait`, 0, "us") }])) };
    };
    const security = (r: Resource, port: number, id: string, chosen = false) => ({ port: q(`${id}.port`, port, "count", "The connection uses this listening port.", chosen), protocol: "tcp" as const, firewalls: incoming(r.id).filter((s) => s.type === "Firewall").map((s) => s.id), tls: { mode: "plaintext" as const, trustedIssuers: [] } });
    const edge = (r: Resource, id: string, sourceRole: string, targetRole = "main", purpose: EdgeContract["purpose"] = "dependency", port = RESOURCE_PORTS[r.type], chosen = false): EdgeContract => ({ purpose, sourceRole, targetRole, transport: r.type === "Database" ? "database" : r.type === "Cache" ? "cache" : "assumed", request: ["request"], response: ["response"], security: security(r, port, id, chosen) });
    const internal = (r: Resource, sourceRole: string, targetRole: string, purpose: EdgeContract["purpose"] = "dependency") => nodes[r.id]!.internalEdges.push({ id: `${sourceRole}-${targetRole}`, ...edge(r, `${r.id}.internal.${sourceRole}-${targetRole}`, sourceRole, targetRole, purpose) });
    const add = (r: Resource, role: string, config: ResourceTemplate) => nodes[r.id]!.resources.push({ role, config });
    for (const r of resources) nodes[r.id] = { type: r.type, profileVersion: "canvas-assumptions/2", provenance: [SOURCE], primary: "main", securityReplacement: "explicit-reviewed/1", resources: [], internalEdges: [], identities: [], listeners: [] };
    const objects = (r: Resource, role: string) => add(r, role, { kind: "object-store", profile: "atomic-current-object/1", ...command(r, role, ["put", "get", "head", "delete"]), capacity: q(`${r.id}.${role}.capacity`, memory.get(r.id)! * 1073741824, "bytes"), initial: [{ namespace: "web", key: "asset", generation: 1, bytes: q(`${r.id}.${role}.asset`, 1024, "bytes"), content: "assumed-asset" }] });
    const commands: ProductContract["commands"] = [];
    for (const r of resources) {
      const id = r.id, n = nodes[id]!, target = outgoing(id)[0];
      switch (r.type) {
        case "Virtual Machine": {
          const data = outgoing(id).filter((t) => ["Database", "Cache"].includes(t.type));
          const cache = data.find((t) => t.type === "Cache"), database = data.find((t) => t.type === "Database");
          if (data.length > 1 && !(data.length === 2 && cache && database && !outgoing(cache.id).length)) { error(`resources.${id}`, "Connect the app to one database, one database-backed cache, or one cache and one database; other combinations need an authored operation plan."); break; }
          const config = execution(r, "main");
          config.memory.limit = q(`${id}.memory.limit`, memory.get(id)! * 1073741824, "bytes", "The memory label is interpreted as GiB for this partial observation only; total memory use remains unknown.");
          if (cache && database) {
            config.downstream = "$self/aside";
            add(r, "aside", { kind: "cache-aside", execution: execution(r, "aside"), cache: `$${cache.id}`, database: `$${database.id}`, keys: ["key"], access: "cycle", coalesce: note(`${id}.cache.singleFlight`, false, "policy", "Plain cache-aside has no single-flight: concurrent misses independently call the database."), onCacheFailure: "database", invalidateWrites: true, operations: { read: "read", write: "write", health: "read" } }); internal(r, "main", "aside");
          } else if (data[0]) config.downstream = `$${data[0].id}${data[0].type === "Cache" ? "/aside" : ""}`;
          add(r, "main", config); break;
        }
        case "Load Balancer": add(r, "main", { kind: "load-balancer", backends: [], policy: note(`${id}.policy`, "round-robin" as const, "policy", "The load balancer sends requests to its app servers in turn (round robin), the default of common cloud load balancers."), maxOutstanding: q(`${id}.outstanding`, 1024 * cores.get(id)!, "count"), maxPending: q(`${id}.pending`, 256, "count"), pendingTimeout: q(`${id}.timeout`, 1000000, "us"), health: { interval: q(`${id}.health.interval`, 5000000, "us"), timeout: q(`${id}.health.timeout`, 1000000, "us"), healthy: q(`${id}.healthy`, 1, "count"), unhealthy: q(`${id}.unhealthy`, 1, "count"), operation: "health", initial: "eligible" } }); break;
        case "Database": {
          const plan = (op: string) => ({ statements: [{ kind: op === "write" ? "write" as const : "snapshot-read" as const, keys: ["key"], cpu: q(`${id}.${op}.cpu`, op === "write" ? 2000 : 1000, "cpu-us"), parallelism: q(`${id}.${op}.parallelism`, 1, "cores"), blockingWait: q(`${id}.${op}.wait`, 0, "us"), logBytes: q(`${id}.${op}.log`, 0, "bytes") }], statementTimeout: q(`${id}.${op}.statementTimeout`, 1000000, "us"), lockTimeout: q(`${id}.${op}.lockTimeout`, 1000000, "us"), transactionTimeout: q(`${id}.${op}.transactionTimeout`, 2000000, "us"), commitWait: q(`${id}.${op}.commitWait`, 0, "us"), durability: "logical-only" as const });
          add(r, "main", { kind: "relational", semantics: "postgresql-keyed/2", execution: execution(r, "main"), maxSessions: q(`${id}.sessions`, r.skuId ? findSku(r.skuId)!.maxConnections! : 100, "count", r.skuId ? "The selected catalog maxConnections is an approximation (owner verify), not a provider guarantee. Each open connection holds one session; a full database refuses new connections." : "Generic PostgreSQL default max_connections is 100. Each open connection holds one session; a full database refuses new connections."), activeTransactions: q(`${id}.active`, 16 * cores.get(id)!, "count"), pendingQueries: q(`${id}.pending`, 256, "count"), keys: ["key"], initial: [{ key: "key", version: 1, bytes: q(`${id}.row`, 1024, "bytes") }], plans: Object.fromEntries(operations.map((op) => [op, plan(op)])) }); break;
        }
        case "Cache":
          if (target && target.type !== "Database") { error(`resources.${id}`, "Connect the cache to one database for cache-aside reads and write invalidation."); break; }
          add(r, "main", { kind: "cache", semantics: "keyed-cache/1", execution: execution(r, "main"), capacity: q(`${id}.capacity`, memory.get(id)! * 1073741824, "bytes"), entryOverhead: q(`${id}.overhead`, 64, "bytes"), policy: "lru", ttl: q(`${id}.ttl`, 60000000, "us"), initial: [], commandCpu: q(`${id}.cpu`, 100, "cpu-us") });
          if (!target) break;
          add(r, "aside", { kind: "cache-aside", execution: execution(r, "aside"), cache: "$self", database: `$${target.id}`, keys: ["key"], access: "cycle", coalesce: note(`${id}.cache.singleFlight`, false, "policy", "Plain cache-aside has no single-flight: concurrent misses independently call the database."), onCacheFailure: "database", invalidateWrites: true, operations: { read: "read", write: "write", health: "read" } }); internal(r, "aside", "main"); break;
        case "Object Storage": objects(r, "main"); break;
        case "CDN":
          if (target?.type !== "Object Storage") { error(`resources.${id}`, "Connect the CDN to one object store; dynamic app origins need an authored HTTP plan."); break; }
          add(r, "main", { kind: "cdn", ...command(r, "main", ["get"]), origin: `$${target.id}`, namespace: "web", keys: { read: "asset", write: "asset", health: "asset" }, capacity: q(`${id}.capacity`, memory.get(id)! * 1073741824, "bytes"), ttl: q(`${id}.ttl`, 60000000, "us"), coalesce: true, maxWaiters: q(`${id}.waiters`, 256, "count") }); break;
        case "Container Registry":
          if (target?.type !== "Object Storage") { error(`resources.${id}`, "Connect the registry to an object store for its blobs and manifests."); break; }
          add(r, "main", { kind: "registry", ...command(r, "main", ["upload", "manifest", "tag", "resolve", "blob"]), store: `$${target.id}`, namespace: "registry" }); break;
        case "DNS":
          if (target?.id !== entry.id) { error(`resources.${id}`, "Point DNS at the design's single load balancer, CDN or app entry point."); break; }
          add(r, "main", { kind: "dns-authority", ...command(r, "main", ["resolve"]), records: [], negativeTtl: q(`${id}.negativeTtl`, 5000000, "us") });
          add(r, "resolver", { kind: "dns-resolver", ...command(r, "resolver", ["resolve"]), authority: "$self", cacheEntries: q(`${id}.entries`, 128, "count") }); internal(r, "resolver", "main", "dns-query"); break;
        case "Firewall": n.firewall = { profile: "ordered-stateful/1", default: "allow", rules: [], maxFlows: q(`${id}.flows`, 10000 * cores.get(id)!, "count") }; break;
        case "Message Queue": add(r, "main", { kind: "delivery-queue", profile: "visibility-work-queue/1", ...command(r, "main", ["publish", "receive", "ack", "nack"]), capacityMessages: q(`${id}.capacity`, 1000 * cores.get(id)!, "count"), capacityBytes: q(`${id}.bytes`, memory.get(id)! * 1073741824, "bytes"), lease: q(`${id}.lease`, 30000000, "us"), retention: q(`${id}.retention`, 300000000, "us"), maxAttempts: q(`${id}.attempts`, 3, "count"), dlqMessages: q(`${id}.dlq`, 1000, "count"), dlqBytes: q(`${id}.dlqBytes`, 1048576, "bytes"), deduplicatePublishes: true, consumers: [{ id: "worker", credit: q(`${id}.credit`, 1, "count") }] }); break;
        case "Monitoring Agent":
          add(r, "main", { kind: "monitor", ...command(r, "main", ["collect", "export"]), targets: [], backend: "$self/backend", operation: "read", interval: q(`${id}.interval`, 10000000, "us"), exportInterval: q(`${id}.exportInterval`, 10000000, "us"), freshFor: q(`${id}.fresh`, 30000000, "us"), sampleBytes: q(`${id}.sample`, 128, "bytes"), bufferBytes: q(`${id}.bufferBytes`, 1048576, "bytes"), bufferSamples: q(`${id}.bufferSamples`, 1000, "count"), batchSamples: q(`${id}.batch`, 100, "count"), attempts: q(`${id}.attempts`, 2, "count") });
          add(r, "backend", { kind: "telemetry-backend", ...command(r, "backend", ["export"]), samples: q(`${id}.samples`, 10000, "count") }); internal(r, "main", "backend", "telemetry-export"); break;
      }
    }
    if (refused.length) return { refused };
    note("database.deadlines", { statementUs: 1000000, transactionUs: 2000000 }, "authored assumption", "Canvas statement and transaction deadlines are authored 1 s / 2 s limits, unlike PostgreSQL/RDS defaults of 0 (disabled). They bound queued work and shorten the unhealthy phase after cache recovery; open idle sessions can persist for the pool idle timeout.");
    const enqueue = (id: string, source: string, target: string, at: number, request: unknown, bytes = 0) => commands.push({ id, source, target, at: q(`${id}.at`, at, "us"), operation: "read", request, bodyBytes: q(`${id}.body`, bytes, "bytes"), provenance: "Assumed bootstrap command, not application traffic." });
    const seedRegistry = (id: string, source: string, target: string) => {
      const digest = `sha256:${"a".repeat(64)}`, manifest = `sha256:${"b".repeat(64)}`;
      enqueue(`${id}.blob`, source, target, 0, { kind: "upload", digest, bytes: 1024 }, 1024);
      enqueue(`${id}.manifest`, source, target, 100000, { kind: "manifest", digest: manifest, bytes: 128, layers: [{ digest, bytes: 1024 }] }, 128);
      enqueue(`${id}.tag`, source, target, 200000, { kind: "tag", tag: "release", digest: manifest });
    };
    for (const r of resources.filter((r) => r.retry?.enabled)) {
      const p = r.retry!, id = `${r.id}.retry`, node = nodes[r.id]!;
      const config = node.resources.find((r) => r.config.kind === "load-balancer")!.config;
      if (config.kind !== "load-balancer") throw Error("Retry owner must be a load balancer");
      const groups = { connectionFailure: ["connect-timeout", "reset", "drained"], timeout: ["acquire-timeout", "response-timeout"], overload: ["pool-overflow", "link-overflow"], backendFailure: ["backend-rejected"] } as const;
      node.profileVersion += "/canvas-retries/1";
      config.retry = {
        profile: "canvas-retries/1", enforceCallerDeadline: true, reserveBackoffBudget: true, preferDifferentBackend: true,
        maxAttempts: q(`${id}.maxAttempts`, p.maxAttempts!, "count", "Saved total attempt limit, including the first attempt.", true),
        backoff: q(`${id}.backoffMs`, p.backoffMs! * 1000, "us", "Saved backoff in milliseconds converted to microseconds.", true),
        jitter: q(`${id}.jitterRatio`, p.jitterRatio!, "ratio", "Saved deterministic jitter ratio.", true),
        maxConcurrentRetries: q(`${id}.maxConcurrentRetries`, p.maxConcurrentRetries!, "count", "Saved limit for waiting and executing retries.", true),
        retryOn: p.retryOn!.flatMap((g) => [...groups[g]]), allowAmbiguousNonIdempotent: false,
        authored: { enabled: { value: true, sources: [`saved-design:${id}.enabled`] }, retryOn: { value: [...p.retryOn!], sources: [`saved-design:${id}.retryOn`] } },
      };
    }
    for (const r of resources.filter((r) => r.autoscaling?.enabled)) {
      const p = r.autoscaling!, id = r.id, lb = incoming(id).find((s) => s.type === "Load Balancer")!;
      if (p.minReplicas === undefined || p.maxReplicas === undefined || p.targetCpu === undefined) { error(`resources.${id}.autoscaling`, "Set the minimum replicas, maximum replicas and CPU target before enabling autoscaling."); continue; }
      const registry = outgoing(id).find((t) => t.type === "Container Registry");
      // Missing image infrastructure is explicit, owned startup overhead, not a drawn node.
      if (!registry) {
        objects(r, "image-store");
        add(r, "registry", { kind: "registry", ...command(r, "registry", ["upload", "manifest", "tag", "resolve", "blob"]), store: "$self/image-store", namespace: "registry" });
        internal(r, "registry", "image-store", "origin"); internal(r, "image", "registry", "artifact");
      }
      add(r, "image", { kind: "artifact-client", ...command(r, "image", ["start"]), registry: registry ? `$${registry.id}` : "$self/registry", cacheBytes: q(`${id}.image.cache`, 1048576, "bytes"), attempts: q(`${id}.image.attempts`, 3, "count"), backoff: q(`${id}.image.backoff`, 1000000, "us"), replicas: [] });
      for (let slot = 0; slot < (registry ? 1 : p.maxReplicas) && slot < 128; slot++) seedRegistry(`${id}.seed.${slot}`, `$${id}#${slot}/image`, registry ? `$${registry.id}` : `$${id}#${slot}/registry`);
      nodes[id]!.controller = { schema: "generic-reconcile/1", version: "1", provenance: [SOURCE], loadBalancer: `$${lb.id}`, initialReady: true, initial: q(`${id}.controller.initial`, p.minReplicas, "count"), min: q(`${id}.controller.min`, p.minReplicas, "count", "The pool minimum comes from the saved policy.", true), max: q(`${id}.controller.max`, p.maxReplicas, "count", "The pool maximum comes from the saved policy.", true), slots: q(`${id}.controller.slots`, p.maxReplicas, "count"), target: q(`${id}.controller.target`, p.targetCpu / 100, "ratio", "The CPU target comes from the saved percentage.", true), interval: q(`${id}.controller.interval`, 10000000, "us"), tolerance: q(`${id}.controller.tolerance`, 0.1, "ratio"), cooldown: q(`${id}.controller.cooldown`, 10000000, "us"), downStabilization: q(`${id}.controller.stabilization`, 30000000, "us"), provision: q(`${id}.controller.provision`, 1000000, "us"), startup: q(`${id}.controller.startup`, 1000000, "us"), drain: q(`${id}.controller.drain`, 5000000, "us"), attempts: q(`${id}.controller.attempts`, 3, "count"), retry: q(`${id}.controller.retry`, 1000000, "us"), signal: { kind: "direct-core-time" }, artifact: { node: id, role: "image", reference: "release" }, provisionFailures: [], manual: [] };
      note(`${id}.controller.bootstrap`, registry ? "drawn registry" : "owned registry and object store", "policy", "Scaling uses one assumed small release image in the drawn registry or owned startup services; initially ready replicas already have their image.");
    }
    for (const e of connections) {
      const s = byId.get(e.sourceId)!, t = byId.get(e.targetId)!;
      let purpose: EdgeContract["purpose"] = "dependency", sourceRole = "main", targetRole = "main";
      if (s.type === "Firewall") purpose = "policy-attachment";
      else if (s.type === "Load Balancer" && t.type === "Virtual Machine") purpose = "routing";
      else if (s.type === "Monitoring Agent" && t.type !== "Firewall") purpose = "monitor-target";
      else if (["CDN", "Container Registry"].includes(s.type) && t.type === "Object Storage") purpose = "origin";
      else if (s.type === "Cache" && t.type === "Database") sourceRole = "aside";
      else if (s.type === "DNS" && t.id === entry.id) purpose = "dependency";
      else if (s.type === "Virtual Machine" && ["Database", "Cache"].includes(t.type)) {
        if (nodes[s.id]!.resources.some((c) => c.role === "aside")) sourceRole = "aside";
        else targetRole = t.type === "Cache" ? "aside" : "main";
      }
      else if (s.type === "Virtual Machine" && s.autoscaling?.enabled && t.type === "Container Registry") { purpose = "artifact"; sourceRole = "image"; }
      else if (s.type === "Virtual Machine" && ["Object Storage", "Message Queue", "Container Registry"].includes(t.type) && !s.autoscaling?.enabled) {
        purpose = t.type === "Container Registry" ? "artifact" : "consumer";
        if (t.type === "Container Registry") seedRegistry(e.id, `$${s.id}`, `$${t.id}`);
        else enqueue(`${e.id}.bootstrap`, `$${s.id}`, `$${t.id}`, 1000000, t.type === "Object Storage" ? { kind: "get", namespace: "web", key: "asset" } : { kind: "publish", logicalId: "assumed-job", delayUs: 0, body: { key: "key", namespace: "web", objectKey: "asset", bytes: 1024 } });
      } else { error(`connections.${e.id}`, `Model 2 has no default operation for ${s.type} calling ${t.type}; change this connection or supply an application contract.`); continue; }
      edges[e.id] = edge(t, `edge.${e.id}`, sourceRole, targetRole, purpose, e.port, true);
    }
    if (refused.length) return { refused };
    let address = 1;
    for (const r of resources) {
      const n = nodes[r.id]!, count = r.autoscaling?.enabled ? r.autoscaling.maxReplicas! : 1;
      for (const { role } of n.resources) {
        n.identities.push({ role, zone: "internal", address: Array.from({ length: Math.min(count, 128) }, () => { const a = address++; return `10.0.${Math.floor(a / 254)}.${a % 254 + 1}`; }).join(",") });
        const ports = new Set([RESOURCE_PORTS[r.type], ...connections.filter((e) => e.targetId === r.id && edges[e.id]!.targetRole === role).map((e) => e.port)]);
        for (const port of [...ports].sort((a, b) => a - b)) n.listeners.push({ role, protocol: "tcp", port: q(`${r.id}.${role}.listener.${port}`, port, "count"), tls: "plaintext" });
      }
    }
    const payloads = { light: q("payload.light", 1024, "bytes"), medium: q("payload.medium", 16384, "bytes"), heavy: q("payload.heavy", 262144, "bytes") };
    const payload = payloads[design.workload.payloadSize];
    const assumedTransport: ProductContract["transports"][string] = { version: "canvas-assumptions/2", ownership: "per-path", provenance: [SOURCE], links: ["request", "response"].map((id) => ({ id, from: id === "request" ? "$source" : "$target", to: id === "request" ? "$target" : "$source", policy: "fifo-message/1", bandwidth: q(`link.${id}.bandwidth`, 125000000, "bytes/s"), propagation: q(`link.${id}.propagation`, 100, "us"), bufferBytes: q(`link.${id}.buffer`, 16777216, "bytes") })), pool: { mode: "serial", reuse: true, maxConnections: q("pool.connections", 32, "count"), streams: q("pool.streams", 1, "count"), pending: q("pool.pending", 256, "count"), establish: q("pool.establish", 100, "us"), acquireTimeout: q("pool.acquireTimeout", 1000000, "us"), connectTimeout: q("pool.connectTimeout", 1000000, "us"), responseTimeout: q("pool.responseTimeout", 4000000, "us"), remoteCancellation: "request-cancellation" }, bytes: Object.fromEntries(operations.map((id) => [id, { request: payload, response: payload }])) };
    const contract: ProductContract = {
      schema: "infraforge-product-model2/1", version: "canvas-assumptions/2", designVersion: "saved-domain/1", catalogVersion: CATALOG_SNAPSHOT_DATE, workloadVersion: "product-arrivals/1", ledger, nodes, edges, capabilities,
      application: { schema: "infraforge-application/1", id: "canvas-default", version: "1", provenance: [SOURCE], validityDomain: SCOPE, controlOperation: "health", readOperation: "read", writeOperation: "write", payloads, operations: operations.map((id) => ({ id, callerTimeout: q(`application.${id}.timeout`, 5000000, "us"), onCallerStop: "request-cancellation", idempotency: id === "write" ? "non-idempotent" : "read-only" })), demands: operations.map((op) => ({ schema: "infraforge-compute-demand/1", id: `canvas.${op}`, version: "1", application: "canvas-default", operation: op, stage: "compute", method: "synthetic", cpu: q(`application.${op}.cpu`, op === "health" ? 100 : op === "write" ? 6000 : 3000, "cpu-us"), blockingWait: q(`application.${op}.wait`, 0, "us"), maxCpuParallelism: q(`application.${op}.parallelism`, 1, "cores"), residentCoverage: "partial", obtainedBy: "Explicit educational defaults", evidence: [SOURCE], date: "2026-10-27", validity: { exact: { environment: "canvas-assumptions" }, ranges: {} }, uncertainty: [SCOPE], freeMode: "forbidden" })) },
      transports: { assumed: assumedTransport, caller: { ...assumedTransport, pool: { ...assumedTransport.pool, maxConnections: q("pool.caller.connections", 512, "count", "Authored open-loop load-generator allowance of 512 concurrent serial connections; this is separate from each app-to-database pool and is not a browser client default.") } }, cache: { ...assumedTransport, pool: { ...assumedTransport.pool, connectTimeout: q("pool.cache.connectTimeout", 10000, "us", "Authored 10 ms cache connect timeout: an unavailable optional cache falls back promptly rather than throttling database demand for a second."), responseTimeout: q("pool.cache.responseTimeout", 10000, "us", "Authored 10 ms cache response timeout for prompt cache-aside fallback, not a Redis/provider default; no retry is added.") } }, database: { ...assumedTransport, pool: { ...assumedTransport.pool, evidenceProfile: "postgresql-pools/2", maxConnections: q("pool.database.connections", 10, "count", "Authored assumption modelled on node-postgres-style pooling: lazy open, at most 10 connections per source replica and database path; the acquire timeout is an authored assumption."), idleTimeout: q("pool.database.idleTimeout", 10000000, "us", "Authored node-postgres-style idle close after 10 seconds.") } } },
      caller: { address: "198.51.100.1", entry: `$${entry.id}`, transport: "caller", request: ["request"], response: ["response"], security: security(entry, RESOURCE_PORTS[entry.type], "caller"), dependencies: [] },
      seed: "canvas-assumptions/2", horizon: q("run.horizon", 30000000, "us", "A saved canvas has no duration, so the default run lasts thirty seconds."), sampleInterval: q("run.sampleInterval", 1000000, "us"), arrival: { start: q("arrival.start", 0, "us"), ...(design.workload.trafficShape === "peak" ? { peak: { start: q("arrival.peak.start", 10000000, "us"), end: q("arrival.peak.end", 20000000, "us") } } : {}) },
      limits: { maxEvents: 2000000, maxSamples: 1000, maxRequests: 100000, maxTraceRows: 100000, maxRawResults: 1000 }, instrumentation: [], commands, faults: [],
    };
    for (const r of resources.filter((r) => r.type === "DNS")) {
      const authority = nodes[r.id]!.resources[0]!.config;
      if (authority.kind === "dns-authority") authority.records.push({ name: "app.example", type: "A", addresses: [nodes[entry.id]!.identities.find((i) => i.role === "main")!.address], generation: 1, ttl: q(`${r.id}.ttl`, 60000000, "us") });
      contract.caller.dependencies.push({ id: r.id, target: `$${r.id}/resolver`, ...edge(r, `caller.dns.${r.id}`, "external", "resolver", "dns-query") });
      contract.caller.security.dns = { name: "app.example", resolver: `$${r.id}/resolver`, routes: [{ address: nodes[entry.id]!.identities[0]!.address, path: "external-entry" }] };
    }
    for (const target of [...new Set(resources.filter((r) => r.type === "Monitoring Agent").flatMap((r) => outgoing(r.id).map((t) => t.id)))].sort()) contract.instrumentation.push({ target: `$${target}`, bytes: q(`instrumentation.${target}`, 128, "bytes") });
    note("security.scope", "logical TCP admission only", "policy", "Public exposure, encryption and open ports stay saved metadata; assumed listeners and allow policies do not certify the design's security.");
    note("application.scope", "one-key educational application", "policy", "Requests use one assumed key; queue, object and registry edges receive explicit bootstrap commands rather than invented application fan-out.");
    note("workload.arrivals", "deterministic open-loop", "policy", "Requests begin immediately at evenly spaced intervals with a fractional read/write mixture; peak traffic occupies seconds ten through twenty.");
    for (const r of saved.resources.filter((r) => r.type === "Load Balancer" && r.autoscaling?.enabled)) note(`${r.id}.poolMapping`, resources.filter((x) => x.autoscaling?.enabled).map((x) => x.id), "policy", "The first app by ID owns the adjustable replicas while its drawn siblings stay fixed, preserving the load balancer's total replica bounds.");
    // Non-numeric policy choices are also reviewable; quantity leaves are already listed above.
    const inspect = (value: unknown, path: string): void => {
      if (path.includes(".config.retry")) return; // Authored quantities and enum/list origins are retained by the retry profile.
      if (/^contract\.nodes\.[^.]+\.type$/.test(path)) return; // The user chose the resource type.
      if (value && typeof value === "object" && "kind" in value && "unit" in value && "provenance" in value) return;
      if (value && typeof value === "object" && Object.keys(value).length) { for (const [key, child] of Object.entries(value)) if (!["ledger", "capabilities", "provenance", "evidence"].includes(key)) inspect(child, `${path}.${key}`); }
      else note(`default.${path}`, value, "setting", `The assumed ${path.replaceAll(".", " ")} is ${JSON.stringify(value)}.`);
    };
    inspect(contract, "contract");
    const compiled = compileProduct(saved, contract);
    if (!compiled.ok) return { refused: compiled.diagnostics.map((d) => ({ ...d, message: `This design cannot run with the default profile: ${d.message}` })) };
    return { contract: canonical(contract), assumptions: assumptions.sort((a, b) => a.id < b.id ? -1 : 1) };
  } catch (cause) {
    error("design", `This saved design needs correction before it can run: ${cause instanceof Error ? cause.message : "invalid saved data"}.`);
    return { refused };
  }
}
