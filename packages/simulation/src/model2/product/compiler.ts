import { RESOURCE_PORTS, securitySettingsError, applicationFlowError, asyncSettingsError, circuitBreakerSettingsError, retrySettingsError } from "@infraforge/domain/resource";
import { requireKnown } from "../../reality/quantity";
import { validateSystems } from "../systems/validate";
import type { SystemsInput } from "../systems/contracts";
import { canonical, derivedLedger } from "./provenance";
import { TRANSLATION_OWNERS, ownerAccepts, rewriteReferences } from "./owners";
import { compileArrivals } from "./workload";
import { compileInterventions } from "./interventions";
import { compilePoisonKeys } from "./poison";
import { compileFaults } from "./faults";
import { validateController } from "./controller-policy";
import type { SavedProductDesign, ProductContract, CompileResult, Diagnostic, SemanticSpec, CompiledPool, EdgeContract } from "./contracts";
import { COMPILER_VERSION } from "./contracts";
import { boundedProduct } from "./bounds";
import { validateSecurityBinding, expandFirewallRules } from "./security";
import { validateMaterializedSemantics } from "./semantics";
import { capReceipt } from "./receiptBudget";
import { capabilityFacts } from "./capabilities";
import { WORKLOAD_LIMITS } from "../workload/policy";
import { numericOrigins } from "./origins";
// Model 1 saves a pool policy on its LB; keep fixed siblings and expand one named VM.
export function savedPoolPolicies(design: SavedProductDesign): SavedProductDesign {
  const resources = design.resources.map((r) => ({ ...r }));
  for (const lb of resources.filter((r) => r.type === "Load Balancer" && r.autoscaling?.enabled)) {
    const children = resources.filter((r) => design.connections.some((e) => e.sourceId === lb.id && e.targetId === r.id)).sort((a, b) => a.id < b.id ? -1 : 1);
    const policy = lb.autoscaling!, fixed = children.length - 1;
    if (!children.length || children.some((r) => r.type !== "Virtual Machine" || r.autoscaling?.enabled) || policy.minReplicas === undefined || policy.maxReplicas === undefined || policy.minReplicas <= fixed) throw Error("Load balancer autoscaling needs app servers without competing pool policies and a minimum covering every drawn server");
    children[0]!.autoscaling = { ...policy, minReplicas: policy.minReplicas - fixed, maxReplicas: policy.maxReplicas - fixed };
    lb.autoscaling = { ...policy, enabled: false };
  }
  return { ...design, resources };
}
export function compileProduct(design: SavedProductDesign, contract: ProductContract): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const error = (code: string, path: string, message: string) => diagnostics.push({ code, path, message, severity: "error" });
  let semantic: SemanticSpec | undefined, phase = "design";
  try {
    boundedProduct(design); boundedProduct(contract);
    design = savedPoolPolicies(design);
    if (contract.applicationFlowProfile !== undefined && !["application-flow/1", "application-flow/2"].includes(contract.applicationFlowProfile)) error("UNKNOWN_FLOW_PROFILE", "applicationFlowProfile", "Unsupported flow profile");
    if ((design.resources.some(r => r.applicationFlow?.schema === "application-flow/2") ? "application-flow/2" : design.resources.some(r => r.applicationFlow) ? "application-flow/1" : undefined) !== contract.applicationFlowProfile) error("FLOW_PROFILE", "applicationFlowProfile", "Saved flow requires the application-flow/1 adapter");
    if (contract.applicationFlowProfile && !contract.version.endsWith(`/${contract.applicationFlowProfile}`)) error("FLOW_VERSION", "version", "Flow semantic version must identify application-flow/1");
    if (contract.failureCauseProfile !== undefined && contract.failureCauseProfile !== "failure-cause/1") error("UNKNOWN_CAUSE_PROFILE", "failureCauseProfile", "Unsupported failure cause profile");
    if (design.schema !== "infraforge-saved-design/1" || contract.schema !== "infraforge-product-model2/1" || !contract.version || !contract.designVersion || !contract.catalogVersion || contract.workloadVersion !== "product-arrivals/1") error("VERSION_REQUIRED", "versions", "Explicit design/compiler/application/catalog/workload versions required");
    if (!contract.application) error("MISSING_APPLICATION_PROFILE", "application", "Missing application execution profile; provider hardware cannot supply operation demand");
    if (design.resources.length > 256 || design.connections.length > 2048 || !design.resources.length) error("DESIGN_BUDGET", "design", "Bounded nonempty design required");
    const hasSecurity = design.resources.some(r => r.listenerSettings !== undefined || r.firewallSettings !== undefined);
    if ((contract.securityProfile !== undefined && contract.securityProfile !== "canvas-security/1") || hasSecurity !== (contract.securityProfile === "canvas-security/1")) error("SECURITY_PROFILE", "securityProfile", "Saved security settings require canvas-security/1 and matching intent");
    const nodes = new Map(design.resources.map((r) => [r.id, r]));
    if (nodes.size !== design.resources.length || design.resources.some((r) => !/^[a-zA-Z0-9_-]{1,64}$/.test(r.id))) error("RESOURCE_ID", "resources", "Unique bounded semantic IDs required; labels/coordinates do not define identity");
    const edgeIds = new Set(design.connections.map((e) => e.id));
    if (edgeIds.size !== design.connections.length) error("EDGE_ID", "connections", "Unique connection identities required");
    const dialled = new Set(design.connections.map(e => `${e.targetId}/${contract.edges?.[e.id]?.targetRole}`));
    for (const d of contract.caller?.dependencies ?? []) dialled.add(d.target.slice(1));
    for (const r of design.resources) {
      const securityError = securitySettingsError(r.type, r.listenerSettings, r.firewallSettings, design.resources);
      if (securityError) error("INVALID_SECURITY", `resources.${r.id}.security`, securityError);
      const flowError = applicationFlowError(r.type, r.applicationFlow);
      if (flowError) error("INVALID_FLOW", `resources.${r.id}.applicationFlow`, flowError);
      if (r.applicationFlow && (r.asyncWorker?.enabled || r.asyncQueue?.enabled)) error("INVALID_FLOW", `resources.${r.id}.applicationFlow`, "Async flow ownership is unsupported");
      const asyncError = asyncSettingsError(r.type, r.asyncQueue, r.asyncWorker);
      if (asyncError) error("INVALID_ASYNC", `resources.${r.id}.async`, asyncError);
      const breakerError = circuitBreakerSettingsError(r.type, r.circuitBreaker);
      if (breakerError) error("INVALID_CIRCUIT_BREAKER", `resources.${r.id}.circuitBreaker`, breakerError);
      const retryError = retrySettingsError(r.type, r.retry);
      if (retryError) error("INVALID_RETRY", `resources.${r.id}.retry`, retryError);
      const allowed = new Set(["id", "type", "x", "y", "skuId", "autoscaling", "asyncQueue", "asyncWorker", "applicationFlow", "listenerSettings", "firewallSettings", "retry", "circuitBreaker", "public", "encryption", "openPorts", "size", "region", "name"]);
      for (const key of Object.keys(r)) if (!allowed.has(key)) error("UNSUPPORTED_RESOURCE_SETTING", `resources.${r.id}.${key}`, "Unrecognized saved setting needs an explicit compiler-version owner");
      const spec = contract.nodes[r.id];
      if (!(r.type in TRANSLATION_OWNERS)) { error("UNSUPPORTED_RESOURCE", `resources.${r.id}`, `No translation owner for ${r.type}`); continue; }
      if (!spec) { error("MISSING_RESOURCE_PROFILE", `nodes.${r.id}`, TRANSLATION_OWNERS[r.type].requires); continue; }
      validateSecurityBinding(r, spec, dialled);
      if (spec.type !== r.type || !spec.profileVersion || !spec.provenance.length) error("RESOURCE_PROFILE", `nodes.${r.id}`, "Matching versioned resource profile/provenance required");
      if (r.circuitBreaker?.enabled && !spec.circuitBreaker) error("MISSING_BREAKER_PROFILE", `nodes.${r.id}.circuitBreaker`, "Enabled circuit breaker requires a reviewed path policy");
      if (spec.circuitBreaker && r.circuitBreaker?.enabled && (requireKnown(spec.circuitBreaker.failureThreshold, "count") !== r.circuitBreaker.failureThreshold || requireKnown(spec.circuitBreaker.cooldown, "us") !== r.circuitBreaker.cooldownMs! * 1000)) error("BREAKER_MISMATCH", `nodes.${r.id}.circuitBreaker`, "Path policy must match saved threshold and cooldown");
      if (spec.circuitBreaker && (r.type !== "Load Balancer" || !r.circuitBreaker?.enabled)) error("BREAKER_BINDING", `nodes.${r.id}.circuitBreaker`, "A path circuit breaker requires enabled load balancer intent");
      if (spec.securityReplacement !== "explicit-reviewed/1") error("LEGACY_SECURITY_INCOMPLETE", `nodes.${r.id}`, "Legacy public/encryption/openPorts are historical only; reviewed listeners, external entry and policy/TLS replacement required");
      if (r.autoscaling?.enabled && !spec.controller) error("MISSING_CONTROLLER_PROFILE", `nodes.${r.id}.controller`, "Legacy autoscaling has no provisioning/readiness/drain or metric-freshness policy");
      if (spec.controller && (r.type !== "Virtual Machine" || !r.autoscaling?.enabled)) error("CONTROLLER_BINDING", `nodes.${r.id}.controller`, "A controller requires an enabled VM pool intent");
      if (spec.controller && (r.autoscaling?.minReplicas !== requireKnown(spec.controller.min, "count") || r.autoscaling?.maxReplicas !== requireKnown(spec.controller.max, "count") || r.autoscaling?.targetCpu === undefined || r.autoscaling.targetCpu / 100 !== requireKnown(spec.controller.target, "ratio"))) error("AUTOSCALING_MISMATCH", `resources.${r.id}.autoscaling`, "Reviewed controller min/max/target must match explicit product intent; no auto defaults");
      if (r.type === "Firewall" ? !spec.firewall || spec.resources.length !== 0 : !spec.resources.some((c) => c.role === spec.primary && ownerAccepts(r.type, c.config))) error("RESOURCE_OWNER", `nodes.${r.id}`, "Primary mechanism must match the resource translation owner");
      if (r.asyncWorker?.enabled) {
        const worker = spec.resources.find((v) => v.role === spec.primary)?.config;
        if (worker?.kind !== "async-worker" || requireKnown(worker.concurrency, "count") !== r.asyncWorker.concurrency || requireKnown(worker.prefetch, "count") !== r.asyncWorker.prefetch || requireKnown(worker.cpu, "cpu-us") !== r.asyncWorker.cpuMsPerJob! * 1000) error("ASYNC_MISMATCH", `nodes.${r.id}`, "Worker profile must match saved parallelism, credit and CPU demand.");
      }
      if (spec.asyncBadJobPercent !== undefined && (!r.asyncWorker?.enabled || r.asyncWorker.badJobPercent === undefined || requireKnown(spec.asyncBadJobPercent, "percent") !== r.asyncWorker.badJobPercent)) error("ASYNC_MISMATCH", `nodes.${r.id}`, "Poison share must match saved worker intent.");
      if (r.asyncWorker?.enabled && r.asyncWorker.badJobPercent !== undefined && spec.asyncBadJobPercent === undefined) error("ASYNC_MISMATCH", `nodes.${r.id}`, "Saved poison share requires an authored profile.");
      if (r.asyncQueue?.enabled) {
        const queue = spec.resources.find((v) => v.role === spec.primary)?.config;
        if (queue?.kind !== "delivery-queue" || requireKnown(queue.lease, "us") !== r.asyncQueue.visibilityTimeoutSeconds! * 1000000 || requireKnown(queue.retention, "us") !== r.asyncQueue.retentionSeconds! * 1000000 || requireKnown(queue.maxAttempts, "count") !== r.asyncQueue.maxReceives || (r.asyncQueue.deadLetterCapacity !== undefined && requireKnown(queue.dlqMessages, "count") !== r.asyncQueue.deadLetterCapacity)) error("ASYNC_MISMATCH", `nodes.${r.id}`, "Queue profile must match saved visibility, retention and delivery limit.");
      }
      if (r.skuId && !contract.capabilities.some((c) => c.resource === r.id && c.sku === r.skuId && c.catalogVersion === contract.catalogVersion)) error("PROVIDER_CAPABILITY_UNKNOWN", `resources.${r.id}.skuId`, "Approximate legacy catalog cannot establish sourced capabilities or application throughput");
    }
    for (const key of Object.keys(contract.nodes)) if (!nodes.has(key)) error("ORPHAN_PROFILE", `nodes.${key}`, "Profile has no saved product resource");
    for (const e of design.connections) {
      if (!nodes.has(e.sourceId) || !nodes.has(e.targetId)) error("UNKNOWN_EDGE_ENDPOINT", `connections.${e.id}`, "Saved edge has no matching resource");
      if (!contract.edges[e.id]) error("AMBIGUOUS_CONNECTION", `connections.${e.id}`, "Drawn edge needs explicit dependency/routing/origin/monitor/consumer/artifact/policy intent");
    }
    for (const key of Object.keys(contract.edges)) if (!edgeIds.has(key)) error("ORPHAN_EDGE_INTENT", `edges.${key}`, "Semantic edge must refer to an actual saved connection");
    if (diagnostics.length) return { ok: false, diagnostics };
    const app = contract.application!;
    if (app.schema !== "infraforge-application/1" || !app.version || !app.id || !app.validityDomain || !app.provenance.length || !app.operations.some((o) => o.id === app.controlOperation)) throw Error("Versioned application provenance/validity, operations and explicit control operation required");
    phase = "provenance"; const provenance = derivedLedger(contract.ledger);
    const runtime: SystemsInput = { ...(contract.securityProfile ? { securityProfile: contract.securityProfile } : {}), ...(contract.failureCauseProfile ? { failureCauseProfile: contract.failureCauseProfile } : {}), modelVersion: "2", workloadVersion: "m2g/1", seed: contract.seed, ledger: provenance.ledger, profiles: [...app.demands].sort((a, b) => a.id < b.id ? -1 : 1), resources: [], operations: [], arrivals: [], faults: [], horizon: contract.horizon, sampleInterval: contract.sampleInterval, limits: contract.limits, interventions: [], links: [], paths: [], networkInterventions: [], endpoints: {}, dataInterventions: [], asyncInterventions: [], systems: { operation: app.controlOperation, identities: [{ id: "$caller", zone: "external", address: contract.caller.address }], listeners: [], firewalls: [], connections: [], instrumentation: [], interventions: [], commands: [] } };
    const pools: CompiledPool[] = [], expansion = new Map<string, string[]>(), roleIds = new Map<string, string>();
    const resources = [...design.resources].sort((a, b) => a.id < b.id ? -1 : 1);
    for (const r of resources) {
      const spec = contract.nodes[r.id]!, count = spec.controller ? requireKnown(spec.controller.slots, "count") : 1;
      if (!Number.isSafeInteger(count) || count < 1 || count > 128 || new Set(spec.resources.map((v) => v.role)).size !== spec.resources.length) throw Error("Invalid replica/role budget");
      const ids = Array.from({ length: count }, (_, n) => spec.controller ? `${r.id}#${n}` : r.id); expansion.set(r.id, ids);
      for (const instance of ids) for (const resource of spec.resources) roleIds.set(`${instance}/${resource.role}`, resource.role === spec.primary ? instance : `${instance}/${resource.role}`);
    }
    const ref = (value: string, instance?: string) => {
      const [node, role] = value.slice(1).split("/"); const owner = node === "self" ? instance! : node!;
      const original = owner.split("#")[0]!, spec = contract.nodes[original]; if (!spec) throw Error(`Unknown semantic reference ${value}`);
      const resolved = roleIds.get(`${owner}/${role ?? spec.primary}`); if (!resolved) throw Error(`Ambiguous pool or unknown role ${value}; use a routing edge or explicit instance`); return resolved;
    };
    phase = "nodes";
    for (const r of resources) {
      const spec = contract.nodes[r.id]!;
      if (spec.firewall) runtime.systems.firewalls.push({ ...spec.firewall, ...(r.firewallSettings ? { rules: expandFirewallRules(spec.firewall.rules, roleIds) } : {}), id: r.id });
      for (const instance of expansion.get(r.id)!) for (const resource of [...spec.resources].sort((a, b) => a.role < b.role ? -1 : 1)) {
        const id = roleIds.get(`${instance}/${resource.role}`)!;
        const material = { ...rewriteReferences(resource.config, (value) => ref(value, instance)), id } as SystemsInput["resources"][number];
        if (material.kind === "compute" && material.applicationFlow) throw Error("Application flows must be compiled from saved per-operation edge references");
        if ("execution" in material) material.execution.id = id;
        runtime.resources.push(material); runtime.endpoints[id] = { alive: true, ready: true };
        const identity = spec.identities.find((p) => p.role === resource.role); if (!identity) throw Error(`Missing explicit network identity ${r.id}/${resource.role}`);
        // Replica addresses are explicit per-slot, never synthesized from a coordinate or ordinal.
        const address = identity.address.split(",")[expansion.get(r.id)!.indexOf(instance)]; if (!address) throw Error(`Missing replica address ${instance}/${resource.role}`);
        runtime.systems.identities.push({ id, zone: identity.zone, address });
        for (const listener of spec.listeners.filter((l) => l.role === resource.role)) { const { role: _role, ...l } = listener; runtime.systems.listeners.push({ ...l, resource: id }); }
      }
    }
    for (const r of resources) {
      const spec = contract.nodes[r.id]!;
      if (spec.controller) {
        validateController(spec.controller, runtime.ledger);
        const replicas = expansion.get(r.id)!, artifacts = replicas.map((instance) => ({ id: ref(spec.controller!.artifact.node === r.id ? `$self/${spec.controller!.artifact.role}` : `$${spec.controller!.artifact.node}/${spec.controller!.artifact.role}`, instance), replica: instance }));
        const profile = { ...spec.controller, loadBalancer: ref(spec.controller.loadBalancer), signal: spec.controller.signal.kind === "observed-core-time" ? { ...spec.controller.signal, backend: ref(spec.controller.signal.backend) } : spec.controller.signal };
        for (const a of artifacts) { const client = runtime.resources.find((s) => s.id === a.id); if (client?.kind !== "artifact-client") throw Error("Scale-out requires owned artifact client"); client.replicas.push({ id: a.replica, target: a.replica, reference: profile.artifact.reference, at: provenance.q(`m2h.${a.replica}.artifactAt`, 0, "us", ["generic-reconcile/1: deferred artifact acquisition begins only after provision"], "implementation-policy") }); }
        pools.push({ id: r.id, replicas, profile, artifactClients: artifacts });
      }
    }
    const links = new Map<string, SystemsInput["links"][number]>();
    const path = (id: string, source: string, target: string, edge: EdgeContract) => {
      if (!edge.transport || !edge.security || !edge.request?.length || !edge.response?.length) throw Error(`Missing transport/listener/security for ${id}; physical bandwidth/propagation remain Unknown`);
      const t = contract.transports[edge.transport]; if (!t?.version || !t.provenance.length || !["per-path", "shared"].includes(t.ownership)) throw Error(`Missing versioned transport/link ownership ${edge.transport}`);
      const prefix = t.ownership === "shared" ? `transport:${edge.transport}` : id;
      for (const l of [...t.links].sort((a, b) => a.id < b.id ? -1 : 1)) {
        const endpoint = (v: string) => v === "$source" ? source : v === "$target" ? target : v.startsWith("$") && v !== "$caller" ? ref(v) : v;
        const mapped = { ...l, id: `${prefix}/${l.id}`, from: endpoint(l.from), to: endpoint(l.to) };
        const old = links.get(mapped.id); if (old && JSON.stringify(canonical(old)) !== JSON.stringify(canonical(mapped))) throw Error(`Conflicting shared physical link ${mapped.id}`); links.set(mapped.id, mapped);
      }
      const breaker = edge.purpose === "routing" ? contract.nodes[source.split("#")[0]!]!.circuitBreaker : undefined;
      runtime.paths.push({ ...(breaker ? { circuitBreaker: breaker } : {}), id, source, target, request: edge.request.map((l) => `${prefix}/${l}`), response: edge.response.map((l) => `${prefix}/${l}`), pool: t.pool, bytes: t.bytes });
      runtime.systems.connections.push({ ...rewriteReferences(edge.security, (v) => ref(v)), path: id });
    };
    phase = "topology";
    const materialized = new Map(runtime.resources.map((r) => [r.id, r]));
    const semanticEdges: SemanticSpec["edges"] = [];
    for (const r of resources) for (const instance of expansion.get(r.id)!) for (const e of [...contract.nodes[r.id]!.internalEdges].sort((a, b) => a.id < b.id ? -1 : 1)) path(`${instance}/internal/${e.id}`, ref(`$self/${e.sourceRole}`, instance), ref(`$self/${e.targetRole}`, instance), e);
    for (const e of [...design.connections].sort((a, b) => a.id < b.id ? -1 : 1)) {
      const intent = contract.edges[e.id]!; semanticEdges.push({ id: e.id, source: e.sourceId, target: e.targetId, purpose: intent.purpose });
      if (intent.purpose === "policy-attachment") { if (nodes.get(e.sourceId)!.type !== "Firewall") throw Error("Policy attachment source must be Firewall"); continue; }
      if (!intent.security || requireKnown(intent.security.port, "count") !== (intent.purpose === "queue-poll" ? RESOURCE_PORTS["Message Queue"] : e.port)) throw Error(`Connection ${e.id} port disagrees with reviewed listener contract`);
      for (const s of expansion.get(e.sourceId)!) for (const t of expansion.get(e.targetId)!) {
        const source = ref(`$self/${intent.sourceRole}`, s), target = ref(`$self/${intent.targetRole}`, t);
        path(`${e.id}:${s}:${t}`, intent.purpose === "queue-poll" ? target : source, intent.purpose === "queue-poll" ? source : target, intent);
        if (intent.purpose === "routing") { const lb = materialized.get(source); if (lb?.kind !== "load-balancer") throw Error("Routing owner must be LB"); lb.backends.push(target); }
        if (intent.purpose === "monitor-target") { const agent = materialized.get(source); if (agent?.kind !== "monitor") throw Error("Monitor-target owner must be Monitoring Agent"); agent.targets.push(target); }
      }
    }
    for (const r of resources) if (r.applicationFlow) for (const instance of expansion.get(r.id)!) {
      const owner = materialized.get(ref(`$self/${contract.nodes[r.id]!.primary}`, instance));
      if (r.applicationFlow.schema === "application-flow/2") {
        const attached = design.connections.filter(e => e.sourceId === r.id).map(e => nodes.get(e.targetId)!);
        const dbs = attached.filter(n => n.type === "Database"), caches = attached.filter(n => n.type === "Cache");
        if (dbs.length > 1 || caches.length > 1 || (caches.length && (dbs.length !== 1 || !design.connections.some(e => e.sourceId === caches[0]!.id && e.targetId === dbs[0]!.id)))) throw Error("Flow /2 needs at most one database and one cache drawn to the same attached database");
      }
      if (owner?.kind !== "compute" || owner.applicationFlow || owner.downstream || owner.downstreamByOperation) throw Error("Flow requires an exclusive compute owner without downstream routing");
      const call = (c: import("@infraforge/domain/resource").FlowCall) => {
        const drawn = design.connections.find(e => e.id === c.edge && e.sourceId === r.id), binding = contract.edges[c.edge];
        if (!drawn || !binding || binding.purpose !== "dependency" || binding.sourceRole !== contract.nodes[r.id]!.primary) throw Error(`Flow call ${c.id} needs a connected outgoing dependency edge`);
        if (!["Virtual Machine", "Load Balancer"].includes(nodes.get(drawn.targetId)!.type) || binding.targetRole !== contract.nodes[drawn.targetId]!.primary) throw Error("Flow v1 supports primary VM/load balancer service roles only");
        const target = ref(`$${drawn.targetId}/${binding.targetRole}`), targetOwner = materialized.get(target);
        if (targetOwner?.kind !== "compute" && targetOwner?.kind !== "load-balancer") throw Error("Flow v1 targets must be compute or load balancer service owners; async workers are unsupported");
        return { id: c.id, kind: "call" as const, target, ...(c.operation ? { operation: c.operation } : {}) };
      };
      const data = (c: import("@infraforge/domain/resource").FlowData) => {
        if (r.applicationFlow!.schema !== "application-flow/2" || contract.applicationFlowProfile !== "application-flow/2") throw Error("Data steps require application-flow/2");
        const drawn = design.connections.find(e => e.id === c.edge && e.sourceId === r.id), binding = contract.edges[c.edge];
        const targetNode = drawn && nodes.get(drawn.targetId), targetSpec = targetNode && contract.nodes[targetNode.id];
        const command = targetNode?.type === "Database" ? "query" as const : targetNode?.type === "Cache" ? "cache-aside" as const : undefined;
        if (!drawn || !binding || !targetNode || !targetSpec || !command || binding.purpose !== "dependency" || binding.sourceRole !== contract.nodes[r.id]!.primary || binding.targetRole !== (command === "query" ? targetSpec.primary : "aside")) throw Error("Data step needs an attached database or database-backed cache edge");
        const target = ref(`$${drawn.targetId}/${binding.targetRole}`), targetOwner = materialized.get(target);
        if (command === "query" ? targetOwner?.kind !== "relational" : targetOwner?.kind !== "cache-aside") throw Error("Data step target command owner mismatch");
        if (targetOwner?.kind === "cache-aside") {
          const attachedDb = design.connections.find(e => e.sourceId === r.id && nodes.get(e.targetId)?.type === "Database");
          if (!attachedDb || targetOwner.cache !== ref(`$${drawn.targetId}`) || targetOwner.database !== ref(`$${attachedDb.targetId}`) || targetOwner.keys.length !== 1 || targetOwner.keys[0] !== "key") throw Error("Typed cache must use the attached cache and database with the assumed key");
        }
        if (command === "query" && c.operation === "write" && design.connections.some(e => e.sourceId === r.id && nodes.get(e.targetId)?.type === "Cache")) throw Error("Use a cache write to update the database and invalidate the attached cache");
        return { id: c.id, kind: "data" as const, target, operation: c.operation, command };
      };
      owner.applicationFlow = { schema: r.applicationFlow.schema, operations: Object.fromEntries(Object.entries(r.applicationFlow.operations).map(([op, flow]) => [op, { steps: flow.steps.map(s => s.kind === "compute" ? s : s.kind === "call" ? call(s) : s.kind === "data" ? data(s) : { ...s, branches: s.branches.map(call) }) }])) };
    }
    const entry = ref(contract.caller.entry); path("external-entry", "$caller", entry, { purpose: "dependency", sourceRole: "external", targetRole: "entry", ...contract.caller });
    for (const e of contract.caller.dependencies) path(`external/${e.id}`, "$caller", ref(e.target), { ...e, sourceRole: "external", targetRole: "target" });
    for (const o of [...app.operations].sort((a, b) => a.id < b.id ? -1 : 1)) runtime.operations.push({ ...o, entry });
    runtime.links = [...links.values()];
    runtime.systems.instrumentation = contract.instrumentation.flatMap((p) => expansion.has(p.target.slice(1)) ? expansion.get(p.target.slice(1))!.map((target) => ({ ...p, target })) : [{ ...p, target: ref(p.target) }]);
    runtime.systems.commands = rewriteReferences(contract.commands, (v) => ref(v));
    phase = "workload"; runtime.arrivals = compileArrivals(design, contract, provenance);
    if (contract.applicationFlowProfile) {
      const memo = new Map<string, number>();
      const calls = (id: string, operation: string, seen = new Set<string>()): number => {
        const key = JSON.stringify([id, operation]); if (seen.has(key)) throw Error("Application flow operation dependency cycle");
        const cached = memo.get(key); if (cached !== undefined) return cached;
        const chain = new Set(seen).add(key), r = materialized.get(id); if (!r) throw Error("Missing flow target");
        if (r.kind === "load-balancer") return 1 + Math.max(0, ...r.backends.map(b => calls(b, operation, chain))) * (r.retry ? requireKnown(r.retry.maxAttempts, "count") : 1);
        if (r.kind !== "compute") return 1;
        const flow = r.applicationFlow?.operations[operation];
        if (!flow) { const target = r.downstreamByOperation?.[operation] ?? r.downstream; return 1 + (target ? calls(target, operation, chain) : 0); }
        const total = 1 + flow.steps.reduce((sum, s) => sum + (s.kind === "compute" ? 1 : s.kind === "data" ? (s.command === "cache-aside" ? 4 : 1) : s.kind === "call" ? calls(s.target, s.operation ?? operation, chain) : s.branches.reduce((n, b) => n + calls(b.target, b.operation ?? operation, chain), 0)), 0);
        memo.set(key, total); return total;
      };
      const factor = Math.max(...runtime.operations.map(op => calls(op.entry, op.id)));
      const maxEvents = contract.limits.maxEvents * factor;
      if (!Number.isSafeInteger(maxEvents) || maxEvents > WORKLOAD_LIMITS.events) throw Error("Flow fan-out exceeds executor event budget; shorten the flow or run");
      const maxLiveCalls = contract.limits.maxRequests * factor;
      if (!Number.isSafeInteger(maxLiveCalls)) throw Error("Flow live-call budget overflows");
      runtime.limits = { ...contract.limits, maxEvents, maxLiveCalls };
    }
    compilePoisonKeys(runtime, contract, provenance);
    phase = "faults"; const crashes = compileFaults(contract.faults, runtime, (id) => expansion.get(id) ?? [id], provenance);
    phase = "interventions"; const interventionReceipts = compileInterventions(design, contract, runtime, provenance).map(capReceipt);
    phase = "capabilities";
    const capabilities = capabilityFacts(contract, resources);
    semantic = { schema: "infraforge-semantic-infrastructure/1", versions: { design: contract.designVersion, compiler: COMPILER_VERSION, model: "2", application: `${app.id}@${app.version}`, catalog: contract.catalogVersion, workload: contract.workloadVersion, contract: contract.version }, nodes: resources.map((r) => ({ id: r.id, type: r.type, owner: TRANSLATION_OWNERS[r.type].owner, profile: contract.nodes[r.id]!.profileVersion })), edges: semanticEdges, capabilities, legacyMetadata: resources.map(({ id, region, public: exposed, encryption, openPorts }) => ({ id, region, public: exposed, encryption, openPorts })), unknown: ["Provider effective CPU/credits, memory/device failure, price/region physics", "TLS crypto CPU/timing, physical link demand unless explicitly supplied", "Application profiles prove only their authored validity domain"], numericOrigins: [] };
    phase = "numeric-provenance"; provenance.audit(runtime); for (const p of pools) provenance.audit(p); provenance.audit(crashes);
    semantic.numericOrigins = numericOrigins(runtime, pools, contract, crashes);
    runtime.ledger.sort((a, b) => a.id < b.id ? -1 : 1);
    phase = "runtime-contract"; validateMaterializedSemantics(runtime, semantic.edges, new Set(design.resources.filter(r => r.listenerSettings !== undefined).flatMap(r => [...roleIds.entries()].filter(([key]) => key.split("/")[0]!.split("#")[0] === r.id).map(([,id]) => id)))); validateSystems(runtime);
    return { ok: true, value: canonical({ schema: "infraforge-compiled-product/1", semantic, input: runtime, pools, crashes, ...(interventionReceipts.length ? {interventionReceipts} : {}) }), diagnostics };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const code = message.startsWith("Missing listener") ? "MISSING_LISTENER" : message.startsWith("Unsupported resource setting") ? "UNSUPPORTED_RESOURCE_SETTING" : /provenance|Anonymous compiler number/.test(message) ? "MISSING_PROVENANCE" : /Missing.*operation|read\/write operation/.test(message) ? "MISSING_OPERATION_MAPPING" : phase.toUpperCase().replaceAll("-", "_") + "_INCOMPLETE";
    error(code, phase, message); return { ok: false, diagnostics, semantic };
  }
}
