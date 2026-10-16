import { z } from "zod";
import { requireKnown } from "@infraforge/simulation/internal-product";
import type { CompiledProduct, ProductContract, SavedProductDesign } from "@infraforge/simulation/internal-product";
import { CompilationRefusal } from "./envelopeV1";
export const CONNECTED_PROFILE = "bounded-connected-web/1";
export const causalLimits = z.object({ events: z.number().int().min(1).max(512), identities: z.number().int().min(1).max(128), textCharacters: z.number().int().min(1).max(65536) }).strict();
export type CausalLimits = z.infer<typeof causalLimits>;
export function connectedRefusal(path: string, message: string): never { throw new CompilationRefusal([{ code: "CONNECTED_SCOPE", path, message, severity: "error" }]); }
export function qualifyConnected(design: SavedProductDesign, contract: ProductContract) {
  const lb = design.resources.filter(r => r.type === "Load Balancer"), apps = design.resources.filter(r => r.type === "Virtual Machine"), db = design.resources.filter(r => r.type === "Database");
  if (design.resources.length !== 4 || lb.length !== 1 || apps.length !== 2 || db.length !== 1 || design.connections.length !== 4) connectedRefusal("design", "Requires one LB, exactly two separate application VMs, one Database and four directed saved connections");
  for (const r of design.resources) {
    if (["skuId", "region", "size", "autoscaling", "public", "encryption", "openPorts"].some(k => k in r)) connectedRefusal(`resources.${r.id}`, "Legacy provider, size, autoscaling and security controls are unsupported; use complete authored contracts");
    const n = contract.nodes?.[r.id];
    if (!n || n.resources?.length !== 1 || n.controller || n.internalEdges?.length || n.firewall) connectedRefusal(`nodes.${r.id}`, "One explicit primary mechanism per saved node; no controllers, auxiliaries or firewall assumptions");
  }
  const expected = new Set(apps.flatMap(a => [`${lb[0]!.id}:${a.id}:routing`, `${a.id}:${db[0]!.id}:dependency`]));
  for (const e of design.connections) {
    if (e.sourceType !== design.resources.find(r => r.id === e.sourceId)?.type || e.targetType !== design.resources.find(r => r.id === e.targetId)?.type) connectedRefusal(`edges.${e.id}`, "Saved direction/type metadata disagrees with endpoints");
    const key = `${e.sourceId}:${e.targetId}:${contract.edges?.[e.id]?.purpose}`;
    if (!expected.delete(key)) connectedRefusal(`edges.${e.id}`, "Ambiguous, duplicate or unsupported directed binding");
  }
  if (expected.size || contract.caller?.entry !== `$${lb[0]!.id}` || contract.caller.dependencies?.length || contract.commands?.length || contract.instrumentation?.length || contract.capabilities?.length) connectedRefusal("contract", "Only caller-to-LB, LB-to-app and app-to-DB work; no separate commands, provider bindings or auxiliary dependencies");
  const app = contract.application, health = contract.nodes[lb[0]!.id]!.resources[0]!.config;
  if (!app || health.kind !== "load-balancer" || new Set([app.readOperation, app.writeOperation, health.health?.operation]).size !== 3) connectedRefusal("operations", "Read, write and DB-backed health must have separate explicit operation identities");
  if (!Array.isArray(contract.faults) || contract.faults.length > 1 || contract.faults.some(f => f.kind !== "Crash" || f.profile !== "retain-logical-state/1" || !apps.some(a => a.id === f.target))) connectedRefusal("faults", "At most one explicitly timed application-process Crash with readiness delay");
  return { lb: lb[0]!.id, apps: apps.map(a => a.id).sort(), database: db[0]!.id, read: app.readOperation, write: app.writeOperation };
}
export function qualifyMaterialized(c: CompiledProduct, topology: ReturnType<typeof qualifyConnected>) {
  const i = c.input, lb = i.resources.find(r => r.id === topology.lb), db = i.resources.find(r => r.id === topology.database);
  if (c.pools.length || i.resources.length !== 4 || i.paths.length !== 5 || i.links.length !== 10 || lb?.kind !== "load-balancer" || db?.kind !== "relational") connectedRefusal("compiled", "Only the four-node, five-path materialization is supported");
  if (lb.retry || JSON.stringify([...lb.backends].sort()) !== JSON.stringify(topology.apps) || !i.operations.some(o => o.id === lb.health.operation)) connectedRefusal("loadBalancer", "Explicit health operation and both routing bindings required; retries excluded");
  if (requireKnown(lb.maxOutstanding, "count") > 32 || requireKnown(lb.maxPending, "count") > 32) connectedRefusal("loadBalancer", "At most 32 outstanding/pending requests");
  if (i.operations.length !== 3 || i.operations.some(o => o.entry !== topology.lb)) connectedRefusal("operations", "Exactly read, write and a separate DB-backed health operation required");
  for (const id of topology.apps) {
    const r = i.resources.find(r => r.id === id);
    if (r?.kind !== "compute" || r.downstream !== topology.database) connectedRefusal(`application.${id}`, "Each application must execute its explicit DB dependency");
    if (requireKnown(r.workers, "count") > 8 || requireKnown(r.queueCapacity, "count") > 32) connectedRefusal(`application.${id}`, "At most eight workers and 32 queued application calls");
  }
  if (db.keys.length > 8 || requireKnown(db.maxSessions, "count") > 8 || requireKnown(db.activeTransactions, "count") > 8 || requireKnown(db.pendingQueries, "count") > 32 || Object.values(db.plans).some(p => p.statements.length > 4)) connectedRefusal("database", "Bounded logical dataset, sessions and transaction plans required");
  if (db.plans[lb.health.operation]!.statements.some(s => s.kind !== "snapshot-read")) connectedRefusal("health", "The separately identified DB-backed health operation must be read-only");
  if (db.plans[topology.read]!.statements.some(s => s.kind !== "snapshot-read") || !db.plans[topology.write]!.statements.some(s => s.kind === "write" || s.kind === "insert")) connectedRefusal("database.plans", "Read operations require snapshot reads; write operations require an explicit logical mutation");
  for (const p of i.paths) {
    const dial = i.systems.connections.find(d => d.path === p.id)!;
    if (p.pool.mode !== "serial" || requireKnown(p.pool.streams, "count") !== 1 || requireKnown(p.pool.maxConnections, "count") > 4 || dial.protocol !== "tcp" || dial.tls.mode !== "plaintext" || dial.tls.trustedIssuers.length || dial.firewalls.length || dial.dns || Object.keys(dial).some(k => !["path", "port", "protocol", "firewalls", "tls"].includes(k))) connectedRefusal(`paths.${p.id}`, "Reviewed plain TCP serial pools only; no implicit TLS, DNS or security guarantees");
  }
}
