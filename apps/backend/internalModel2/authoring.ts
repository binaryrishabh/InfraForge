import { z } from "zod";
import { authoringGroups } from "@infraforge/contracts/internal-model2";
import type { AuthoringDraft, Diagnostic, InternalDesign } from "@infraforge/contracts/internal-model2";
import type { ProductContract, Quantity, Unit } from "@infraforge/simulation/internal-product";
import { LayoutSchema } from "../zod_schemas/layout.schema";
import { CompilationRefusal } from "./envelope";
const text = z.string().trim().min(1).max(200);
export const authoringRequest = z.object({ infrastructureId: z.uuid(), expectedDesignUpdatedAt: z.iso.datetime(), idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  authoring: z.object({ schema: z.literal("infraforge-authoring/1"), origin: text, values: z.record(z.string(), z.string().max(40)),
    vmAddress: text, objectAddress: text, callerAddress: text, zone: z.enum(["internal", "external"]), security: z.literal("plaintext-reviewed"),
    commands: z.array(z.object({ at: z.string().max(40), kind: z.enum(["put", "get", "head", "delete"]), namespace: text, key: text, bytes: z.string().max(40), content: z.string().max(1000) }).strict()).max(16),
    crash: z.boolean(), crashAt: z.string().max(40), crashDuration: z.string().max(40), restart: z.string().max(40) }).strict() }).strict();
export const authoredAssumptions = [
  "All numeric values are explicitly authored educational assumptions. Valid only for this recorded scenario; no provider measurement or physical performance claim.",
  "Standalone VM CPU application work and scheduled VM-to-object commands are separate. Commands do not represent application dependency calls.",
  "Empty initial current-object store; atomic current-object semantics, no versions. Logical retention through an optional process crash is not physical durability.",
  "Plain TCP, reviewed explicit listeners; no firewall or TLS. No protection, exposure or encryption guarantee. Addresses and zone are authored identifiers.",
  "Per-path FIFO message links in both directions; serial reusable pools; cooperative cancellation, caller request-cancellation, no automatic retries.",
  "Capped equal-fluid CPU scheduler. Object command CPU uses the same authored execution profile. Complete resident memory is Unknown; observation does not enforce memory limits.",
  "Steady deterministic arrivals from requests/minute and read fraction. All payload labels map to the explicitly authored byte size; no inferred payload default.",
  "Physical throughput, cloud timing, reliability, durability and full cloud pricing remain Unknown. Model 1 ACTIVE; Model 2 INTERNAL; production PARKED.",
  "M2K storage/retention caps: 512 KiB input, 256 KiB capture, 32 checkpoints, 4 active / 100 retained per owner, 1000 global. Evidence exhaustion remains Unknown; no crash resume.",
];
export function assessDesign(row: { id: string; name: string; updatedAt: Date; layout: unknown; challengeId: string | null }): InternalDesign {
  const result: InternalDesign = { id: row.id, name: row.name, updatedAt: row.updatedAt.toISOString(), supported: false, reasons: [] };
  if (row.challengeId) result.reasons.push("Published challenge workspaces are excluded.");
  const parsed = LayoutSchema.safeParse(row.layout);
  if (!parsed.success) { result.reasons.push("Saved layout is invalid."); return result; }
  const { resources, connectionLines } = parsed.data, vm = resources.filter((r) => r.type === "Virtual Machine"), objects = resources.filter((r) => r.type === "Object Storage");
  if (resources.length !== 2 || vm.length !== 1 || objects.length !== 1) result.reasons.push("Requires exactly one Virtual Machine and one Object Storage node.");
  for (const r of resources) for (const key of ["skuId", "size", "region", "public", "encryption", "openPorts", "autoscaling"]) if (key in r) result.reasons.push(`${r.name || r.id}: ${key} is outside the internal scope. Review a separate design; this workspace never removes saved fields.`);
  const link = connectionLines[0];
  if (connectionLines.length !== 1 || !link || link.sourceId !== vm[0]?.id || link.targetId !== objects[0]?.id) result.reasons.push("Authoring requires one directed VM-to-object connection.");
  if (!result.reasons.length) Object.assign(result, { supported: true, vm: vm[0]!.id, objects: objects[0]!.id, connection: link!.id, port: link!.port });
  return result;
}
export function parseValues(draft: AuthoringDraft) {
  const values: Record<string, number> = {}, diagnostics: Diagnostic[] = [], fields = authoringGroups.flatMap((g) => g.fields);
  const number = (key: string, raw: string | undefined, min: number, max: number, integer = false) => {
    const n = raw?.trim() ? Number(raw) : NaN;
    if (!Number.isFinite(n) || n < min || n > max || integer && !Number.isSafeInteger(n)) diagnostics.push({ code: "AUTHORED_VALUE", path: key, message: `Enter ${integer ? "an integer" : "a number"} from ${min} to ${max}; no value is supplied automatically.` });
    values[key] = n;
  };
  for (const f of fields) number(f.key, draft.values[f.key], f.min, f.max, f.integer);
  for (const key of Object.keys(draft.values)) if (!fields.some((f) => f.key === key)) diagnostics.push({ code: "UNSUPPORTED_FIELD", path: key, message: "This authoring field is unsupported." });
  draft.commands.forEach((c, i) => { number(`commands.${i}.at`, c.at, 0, values.horizon!, true); if (c.kind === "put") number(`commands.${i}.bytes`, c.bytes, 0, values.capacity!, true); });
  if (draft.crash) { number("crashAt", draft.crashAt, 0, values.horizon!, true); number("crashDuration", draft.crashDuration, 1, values.horizon!, true); number("restart", draft.restart, 0, values.horizon!, true); }
  if (diagnostics.length) throw new CompilationRefusal(diagnostics.map((d) => ({ ...d, severity: "error" })));
  return values;
}
export function authoredContract(draft: AuthoringDraft, design: InternalDesign) {
  const v = parseValues(draft), ledger: ProductContract["ledger"] = [];
  const q = <U extends Unit>(key: string, value: number, unit: U): Quantity<U> => {
    const quantity: Quantity<U> = { kind: "known", value, unit, provenance: [`authored.${key}`] };
    ledger.push({ id: `authored.${key}`, concept: key, modelVersion: "2", scope: "Owner-reviewed internal authored scenario", validityDomain: "This recorded authored scenario only; physical and provider validity Unknown", quantity,
      formula: String(value), classification: "educational-assumption", confidence: "conditional", provenance: [{ source: draft.origin, supports: "implementation", detail: "Explicit author assertion, not provider or physical measurement" }],
      assumptions: [authoredAssumptions[0]!], researchedOn: "2026-10-16", freeMode: "forbidden", replacement: "Workload-specific independently sourced profiles before physical claims" }); return quantity;
  };
  const n = <U extends Unit>(key: string, unit: U) => q(key, v[key]!, unit);
  const cores = n("cores", "cores"), workers = n("workers", "count"), queue = n("queue", "count"), port = n("port", "count");
  const execution = { id: "owner-authored", kind: "compute" as const, cores, workers, scheduler: "capped-equal-fluid/1" as const, queueCapacity: queue,
    profiles: { read: "authored.read", write: "authored.write" }, context: { labels: { environment: "owner-authored" }, quantities: {} }, cancellation: "cooperative" as const, memory: { coverage: "partial" as const, policy: "observe" as const } };
  const security = { port, protocol: "tcp" as const, firewalls: [], tls: { mode: "plaintext" as const, trustedIssuers: [] } };
  const body = n("payload", "bytes"), wait = n("appWait", "us"), parallel = n("parallel", "cores"), callerTimeout = n("callerTimeout", "us");
  const concurrency = n("objectConcurrency", "count"), pending = n("objectQueue", "count"), objectTimeout = n("objectTimeout", "us"), objectCpu = n("objectCpu", "cpu-us"), objectWait = n("objectWait", "us"), capacity = n("capacity", "bytes");
  const contract: ProductContract = { schema: "infraforge-product-model2/1", version: "internal-authoring/1", designVersion: "saved-domain/1", catalogVersion: "unselected-authored/1", workloadVersion: "product-arrivals/1", ledger,
    application: { schema: "infraforge-application/1", id: "owner-authored", version: "1", provenance: [draft.origin], validityDomain: "Owner-authored software scenario only",
      operations: ["read", "write"].map((id) => ({ id, callerTimeout, onCallerStop: "request-cancellation", idempotency: id === "read" ? "read-only" : "non-idempotent" })),
      demands: ["read", "write"].map((operation) => ({ schema: "infraforge-compute-demand/1", id: `authored.${operation}`, version: "1", application: "owner-authored", operation, stage: "compute", method: "synthetic", cpu: n(`${operation}Cpu`, "cpu-us"), blockingWait: wait, maxCpuParallelism: parallel, residentCoverage: "partial", obtainedBy: draft.origin, evidence: [draft.origin], date: "2026-10-16", validity: { exact: { environment: "owner-authored" }, ranges: {} }, uncertainty: ["Physical demand and complete memory Unknown"], freeMode: "forbidden" })),
      controlOperation: "read", readOperation: "read", writeOperation: "write", payloads: { light: body, medium: body, heavy: body } },
    nodes: {}, edges: {}, transports: {}, caller: { address: draft.callerAddress, entry: `$${design.vm}`, transport: "authored", request: ["request"], response: ["response"], security, dependencies: [] },
    seed: `owner-authored:${draft.origin}`, horizon: n("horizon", "us"), sampleInterval: n("sample", "us"), arrival: { start: n("start", "us") },
    limits: { maxEvents: v.maxEvents!, maxRequests: v.maxRequests!, maxSamples: v.maxSamples!, maxTraceRows: v.maxTraceRows!, maxRawResults: v.maxRawResults! }, instrumentation: [], capabilities: [], commands: [], faults: [] };
  for (const [id, type, address] of [[design.vm!, "Virtual Machine", draft.vmAddress], [design.objects!, "Object Storage", draft.objectAddress]] as const) contract.nodes[id] = {
    type, primary: "main", profileVersion: "owner-authored/1", provenance: [draft.origin], securityReplacement: "explicit-reviewed/1",
    resources: [{ role: "main", config: type === "Virtual Machine" ? execution : { kind: "object-store", profile: "atomic-current-object/1", execution, concurrency, pending, timeout: objectTimeout, demands: Object.fromEntries(["put", "get", "head", "delete"].map((kind) => [kind, { cpu: objectCpu, wait: objectWait }])), initial: [], capacity } }],
    internalEdges: [], identities: [{ role: "main", zone: draft.zone as "internal" | "external", address }], listeners: [{ role: "main", protocol: "tcp", port, tls: "plaintext" }] };
  contract.edges[design.connection!] = { purpose: "dependency", sourceRole: "main", targetRole: "main", transport: "authored", request: ["request"], response: ["response"], security };
  const requestBytes = n("requestBytes", "bytes"), responseBytes = n("responseBytes", "bytes");
  contract.transports.authored = { version: "owner-authored/1", ownership: "per-path", provenance: [draft.origin], links: [
    { id: "request", from: "$source", to: "$target", policy: "fifo-message/1", bandwidth: n("bandwidth", "bytes/s"), propagation: n("propagation", "us"), bufferBytes: n("buffer", "bytes") },
    { id: "response", from: "$target", to: "$source", policy: "fifo-message/1", bandwidth: q("returnBandwidth", v.bandwidth!, "bytes/s"), propagation: q("returnPropagation", v.propagation!, "us"), bufferBytes: q("returnBuffer", v.buffer!, "bytes") }],
    pool: { mode: "serial", reuse: true, maxConnections: n("connections", "count"), streams: n("streams", "count"), pending: n("poolQueue", "count"), establish: n("establish", "us"), acquireTimeout: n("acquire", "us"), connectTimeout: n("connect", "us"), responseTimeout: n("response", "us"), remoteCancellation: "request-cancellation" },
    bytes: { read: { request: requestBytes, response: responseBytes }, write: { request: requestBytes, response: responseBytes } } };
  draft.commands.forEach((c, i) => { const request = c.kind === "put" ? { kind: c.kind, namespace: c.namespace, key: c.key, bytes: v[`commands.${i}.bytes`]!, content: c.content } : { kind: c.kind, namespace: c.namespace, key: c.key };
    contract.commands.push({ id: `command-${i + 1}`, at: q(`command.${i}.at`, v[`commands.${i}.at`]!, "us"), source: `$${design.vm}`, target: `$${design.objects}`, operation: c.kind === "get" || c.kind === "head" ? "read" : "write", request,
      bodyBytes: q(`command.${i}.body`, c.kind === "put" ? v[`commands.${i}.bytes`]! : 0, "bytes"), provenance: `${draft.origin}; explicit recorded command, not application traffic` }); });
  if (draft.crash) contract.faults.push({ id: "authored-object-process", kind: "Crash", target: design.objects!, at: q("crashAt", v.crashAt!, "us"), duration: q("crashDuration", v.crashDuration!, "us"), restart: q("restart", v.restart!, "us"), profile: "retain-logical-state/1" });
  return { contract, values: v, workload: { targetThroughput: v.rate!, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: v.readRatio!, payloadSize: "light" as const } };
}
