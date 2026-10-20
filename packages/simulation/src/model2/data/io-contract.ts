import { requireKnown, type Quantity } from "../../reality/quantity";
import type { DataInput, RelationalConfig } from "./contracts";
import type { IoDevice } from "../composition/io-budget";

export interface IoEvidence { kind: "observed" | "authored"; source: string; revision: string; domain: string; label: "supported-logical" | "assumption-only" }
export type IoQuantity<U extends string> = { unit: U } & ({ value: number; evidence: IoEvidence } | { value: null; reason: string });
export interface FiniteIoProfile {
  schema: "postgresql-keyed-io/1";
  identity: { profile: string; revision: string; workload: string; evidence: IoEvidence };
  devices: Array<{ id: string; generation: number; policy: IoDevice["policy"]; queueOperations: IoQuantity<"count">; queueBytes: IoQuantity<"bytes">; serviceConcurrency: IoQuantity<"count">; iops: IoQuantity<"operations/s">; bytesPerSecond: IoQuantity<"bytes/s">; flushServiceUs: IoQuantity<"us"> }>;
  buffers: Array<{ owner: string; host: string; device: string; pageBytes: IoQuantity<"bytes">; capacityBytes: IoQuantity<"bytes">; initialPages: string[]; policy: "declared-clean-page-lru/1"; singleFlight: "coalesced/1" }>;
  // A binding is a whole finite transaction, with one page sequence per statement.
  bindings: Array<{ role: string; operation: string; keys: string[]; buffer: string; statementPages: string[][]; walBytes: IoQuantity<"bytes">; walOperations: IoQuantity<"count">; commitAck: "read-only" | "logical-only" | "declared-local-wal-flush" }>;
  background: { policy: "excluded-unknown" | "explicit-bounded-schedule"; schedule: Array<{ id: string; device: string; atUs: IoQuantity<"us">; bytes: IoQuantity<"bytes">; evidence: IoEvidence }> };
  limits: { maxPages: number; maxReceipts: number; maxScheduledBackgroundOperations: number; maxScheduledBackgroundBytes: number };
}
export const ioNumber = <U extends string>(q: IoQuantity<U>, unit: U, min = 0, integer = true) => {
  fields(q, ["value", "unit", ...(q.value === null ? ["reason"] : ["evidence"])]);
  if (q.value === null) throw Error(`Unknown required IO ${unit}: ${q.reason}`);
  evidence(q.evidence);
  if (q.unit !== unit || !Number.isFinite(q.value) || q.value < min || (integer && !Number.isSafeInteger(q.value))) throw Error(`Invalid IO ${unit}`);
  return q.value;
};
function fields(value: object, expected: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== expected.length || expected.some(k => !Object.hasOwn(value, k))) throw Error("Invalid IO fields");
}
function id(value: string) { if (typeof value !== "string" || !value.trim() || value.length > 256) throw Error("Invalid bounded IO identity"); }
function evidence(e: IoEvidence) {
  fields(e, ["kind", "source", "revision", "domain", "label"]);
  [e.source, e.revision, e.domain].forEach(id);
  if (!["observed", "authored"].includes(e.kind) || !["supported-logical", "assumption-only"].includes(e.label)) throw Error("Invalid IO evidence");
}
function list<T>(xs: T[], max: number, min = 0) { if (!Array.isArray(xs) || xs.length < min || xs.length > max) throw Error("Finite IO collection budget"); }
function unique(xs: string[]) { xs.forEach(id); if (new Set(xs).size !== xs.length) throw Error("Duplicate IO identity"); }

export function validateFiniteIo(p: FiniteIoProfile, input: DataInput, composition: {
  hosts: Array<{ id: string; memory: Quantity<"bytes"> }>;
  bindings: Array<{ resource: string; host: string; reservedMemory: Quantity<"bytes"> }>;
}) {
  fields(p, ["schema", "identity", "devices", "buffers", "bindings", "background", "limits"]);
  if (p.schema !== "postgresql-keyed-io/1" || input.workloadVersion !== "m2e-pg/1") throw Error("Finite IO requires explicit PG revision");
  fields(p.identity, ["profile", "revision", "workload", "evidence"]); [p.identity.profile, p.identity.revision, p.identity.workload].forEach(id); evidence(p.identity.evidence);
  fields(p.limits, ["maxPages", "maxReceipts", "maxScheduledBackgroundOperations", "maxScheduledBackgroundBytes"]);
  for (const key of ["maxPages", "maxReceipts", "maxScheduledBackgroundOperations"] as const) if (!Number.isSafeInteger(p.limits[key]) || p.limits[key] < (key === "maxScheduledBackgroundOperations" ? 0 : 1) || p.limits[key] > 10000) throw Error("Invalid IO limits");
  if (!Number.isSafeInteger(p.limits.maxScheduledBackgroundBytes) || p.limits.maxScheduledBackgroundBytes < 0 || p.limits.maxScheduledBackgroundBytes > 1073741824) throw Error("Invalid background byte limit");
  list(p.devices, 16, 1); list(p.buffers, 16, 1); list(p.bindings, 10000, 1);
  unique(p.devices.map(d => d.id)); unique(p.buffers.map(b => b.owner));
  const devices = new Map(p.devices.map(d => [d.id, d])), buffers = new Map(p.buffers.map(b => [b.owner, b]));
  for (const d of p.devices) {
    fields(d, ["id", "generation", "policy", "queueOperations", "queueBytes", "serviceConcurrency", "iops", "bytesPerSecond", "flushServiceUs"]);
    if (!Number.isSafeInteger(d.generation) || d.generation < 0 || d.policy !== "fifo-max-operation-byte-service/1" || ioNumber(d.serviceConcurrency, "count", 1) !== 1) throw Error("Unsupported IO service policy/concurrency");
    ioNumber(d.queueOperations, "count", 1);
    const bytes = ioNumber(d.queueBytes, "bytes", 1), iops = ioNumber(d.iops, "operations/s", Number.MIN_VALUE, false), rate = ioNumber(d.bytesPerSecond, "bytes/s", Number.MIN_VALUE, false), flush = ioNumber(d.flushServiceUs, "us");
    if (!Number.isSafeInteger(bytes * p.limits.maxReceipts) || !Number.isSafeInteger(requireKnown(input.horizon, "us") + Math.ceil(Math.max(1_000_000 / iops, bytes * 1_000_000 / rate)) + flush)) throw Error("IO service accounting/time overflow");
  }
  let pages = 0;
  for (const b of p.buffers) {
    fields(b, ["owner", "host", "device", "pageBytes", "capacityBytes", "initialPages", "policy", "singleFlight"]); [b.host, b.device].forEach(id);
    const page = ioNumber(b.pageBytes, "bytes", 1), capacity = ioNumber(b.capacityBytes, "bytes", 1), device = devices.get(b.device);
    list(b.initialPages, p.limits.maxPages); unique(b.initialPages);
    if (!device || b.policy !== "declared-clean-page-lru/1" || b.singleFlight !== "coalesced/1" || capacity % page || b.initialPages.length > capacity / page || page > ioNumber(device.queueBytes, "bytes")) throw Error("Invalid IO buffer/device budget");
    if (!composition.hosts.some(h => h.id === b.host) || input.resources.some(x => x.id === b.owner)) throw Error("Invalid buffer memory owner/host");
    pages += capacity / page;
    if (pages > p.limits.maxPages) throw Error("Global IO page budget exhausted");
  }
  // Buffer capacity is a separate lease counted exactly once, in addition to
  // authored process reservations. Full process RSS remains Unknown.
  for (const h of composition.hosts) {
    const reserved = composition.bindings.filter(b => b.host === h.id).reduce((n, b) => n + requireKnown(b.reservedMemory, "bytes"), 0) + p.buffers.filter(b => b.host === h.id).reduce((n, b) => n + ioNumber(b.capacityBytes, "bytes"), 0);
    if (reserved > requireKnown(h.memory, "bytes")) throw Error("IO buffer host memory exhausted");
  }
  const identities: string[] = [];
  for (const b of p.bindings) {
    fields(b, ["role", "operation", "keys", "buffer", "statementPages", "walBytes", "walOperations", "commitAck"]); [b.role, b.operation, b.buffer].forEach(id);
    list(b.keys, 10000, 1); unique(b.keys); list(b.statementPages, 32, 1);
    identities.push(JSON.stringify([b.role, b.operation, b.keys]));
    const r = input.resources.find(r => r.id === b.role) as RelationalConfig | undefined, buffer = buffers.get(b.buffer);
    const plan = r?.kind === "relational" ? r.plans[b.operation] : undefined;
    if (!plan || r!.semantics !== "postgresql-keyed/1" || !buffer || !composition.bindings.some(x => x.resource === b.role && x.host === buffer.host) || b.keys.some(k => !r!.keys.includes(k)) || b.statementPages.length !== plan.statements.length) throw Error("Invalid IO role/key/plan placement");
    const expectedKeys = [...new Set(plan.statements.flatMap(s => s.keys.flatMap(k => k === "$key" ? b.keys : [k])))];
    if (JSON.stringify(expectedKeys) !== JSON.stringify(b.keys) || (plan.statements.some(s => s.keys.includes("$key")) && b.keys.length !== 1)) throw Error("IO key binding mismatch");
    if (requireKnown(plan.commitWait, "us") !== 0) throw Error("Finite IO replaces authored commit wait; explicit zero required");
    for (const xs of b.statementPages) { list(xs, p.limits.maxPages); pages += xs.length; if (pages > p.limits.maxPages) throw Error("Global IO page budget exhausted"); xs.forEach(id); }
    const bytes = ioNumber(b.walBytes, "bytes"), ops = ioNumber(b.walOperations, "count"), read = plan.statements.every(s => s.kind === "snapshot-read" || s.kind === "lock-read");
    if (ops > p.limits.maxReceipts || (bytes > 0 && ops === 0) || (read && (bytes !== 0 || ops !== 0 || b.commitAck !== "read-only")) || (!read && !["logical-only", "declared-local-wal-flush"].includes(b.commitAck))) throw Error("Invalid WAL acknowledgement/demand");
    if ((b.commitAck === "declared-local-wal-flush") !== (plan.durability === "authored-log-ack")) throw Error("WAL durability mismatch");
    if (plan.statements.reduce((n, s) => n + requireKnown(s.logBytes, "bytes"), 0) !== bytes) throw Error("WAL logical bytes mismatch");
    if (ops && Math.ceil(bytes / ops) > ioNumber(devices.get(buffer.device)!.queueBytes, "bytes")) throw Error("WAL operation cannot fit device queue");
  }
  unique(identities);
  if (pages > p.limits.maxPages) throw Error("Global IO page budget exhausted");
  for (const r of input.resources) if (r.kind === "relational") for (const op of input.operations) {
    const plan = r.plans[op.id]!;
    if (plan.statements.some(s => s.keys.includes("$key"))) {
      for (const key of r.keys) if (!p.bindings.some(b => b.role === r.id && b.operation === op.id && b.keys.length === 1 && b.keys[0] === key)) throw Error("Missing finite IO key binding");
    } else if (!p.bindings.some(b => b.role === r.id && b.operation === op.id)) throw Error("Missing finite IO plan binding");
  }
  fields(p.background, ["policy", "schedule"]); list(p.background.schedule, p.limits.maxScheduledBackgroundOperations); unique(p.background.schedule.map(s => s.id));
  if (!["excluded-unknown", "explicit-bounded-schedule"].includes(p.background.policy) || (p.background.policy === "excluded-unknown" && p.background.schedule.length)) throw Error("Invalid background policy");
  let backgroundBytes = 0;
  for (const s of p.background.schedule) {
    fields(s, ["id", "device", "atUs", "bytes", "evidence"]); evidence(s.evidence);
    const d = devices.get(s.device); if (!d || ioNumber(s.atUs, "us") > requireKnown(input.horizon, "us")) throw Error("Invalid background device/time");
    const bytes = ioNumber(s.bytes, "bytes"); if (bytes > ioNumber(d.queueBytes, "bytes")) throw Error("Background operation cannot fit"); backgroundBytes += bytes;
  }
  if (backgroundBytes > p.limits.maxScheduledBackgroundBytes) throw Error("Background byte budget exhausted");
}
