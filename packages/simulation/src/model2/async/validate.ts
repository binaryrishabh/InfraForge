import { requireKnown, type Quantity, type Unit } from "../../reality/quantity";
import type { AsyncInput, AsyncResource } from "./contracts";
import type { DataInput } from "../data/contracts";
import { validateData } from "../data/validate";
import { ASYNC_LIMITS as caps } from "./policy";
import { micros } from "../time";
export const isAsync = (r: AsyncInput["resources"][number]): r is AsyncResource => ["delivery-queue", "object-store", "async-publisher", "async-worker"].includes(r.kind);
// Databases with PostgreSQL semantics (per-connection sessions) run under the PostgreSQL data revision.
const dataRevision = (i: AsyncInput) => i.resources.some((r) => r.kind === "relational" && r.semantics === "postgresql-keyed/2") ? "m2e-pg/2" as const : i.resources.some((r) => r.kind === "relational" && r.semantics === "postgresql-keyed/1") ? "m2e-pg/1" as const : "m2e/1" as const;
export const dataAdapter = (i: AsyncInput): DataInput => ({ ...i, workloadVersion: dataRevision(i), resources: i.resources.map((r) => isAsync(r) ? { ...r.execution, id: r.id, downstream: undefined } : r) });
export function validateAsync(i: AsyncInput) {
  validateData(dataAdapter(i));
  if (i.workloadVersion !== "m2f/1" || i.asyncInterventions.length > caps.interventions) throw Error("Invalid async revision/budget");
  const ledger = new Map(i.ledger.map((e) => [e.id, e.quantity])), horizon = requireKnown(i.horizon, "us"), resources = new Map(i.resources.map((r) => [r.id, r]));
  const n = <U extends Unit>(q: Quantity<U>, unit: U, min = 0, integer = true) => { const value = requireKnown(q, unit); if (value < min || (integer && !Number.isSafeInteger(value)) || !q.provenance.length || q.provenance.some((id) => { const v = ledger.get(id); return !v || v.kind !== "known" || v.unit !== unit || v.value !== value; })) throw Error("Invalid async quantity/provenance"); return value; };
  const key = (s: string) => typeof s === "string" && s.length > 0 && s.length <= caps.keyCharacters;
  const path = (source: string, target: string) => { if (!i.paths.some((p) => p.source === source && p.target === target)) throw Error(`Missing async transport path ${source}->${target}`); };
  for (const r of i.resources) if (isAsync(r)) {
    if (r.execution.id !== r.id || r.execution.downstream || r.execution.quota || r.execution.memory.coverage !== "partial" || r.execution.memory.policy !== "observe" || Object.keys(r.execution.memory).some((k) => !["coverage", "policy"].includes(k)) || i.interventions.some((f) => f.target === r.id) || i.faults.some((f) => f.target === r.id) || i.dataInterventions.some((f) => f.target === r.id)) throw Error("Async resources own execution/fault policy; process memory Unknown");
    if (r.kind === "delivery-queue" || r.kind === "object-store") {
      if (n(r.concurrency, "count", 1) > caps.concurrency) throw Error("Command concurrency budget"); n(r.pending, "count"); micros(horizon + n(r.timeout, "us", 1));
      const commands = r.kind === "delivery-queue" ? ["publish", "receive", "ack", "nack"] : ["put", "get", "head", "delete"];
      for (const command of commands) { const d = r.demands[command]; if (!d) throw Error("Missing async command demand"); n(d.cpu, "cpu-us", Number.MIN_VALUE, false); micros(horizon + n(d.wait, "us")); }
      if (r.kind === "delivery-queue") {
        if (r.profile !== "visibility-work-queue/1" || n(r.capacityMessages, "count", 1) > caps.messages || n(r.dlqMessages, "count") > caps.messages || n(r.maxAttempts, "count", 1) > caps.attempts || r.consumers.length > caps.consumers || new Set(r.consumers.map((c) => c.id)).size !== r.consumers.length || typeof r.deduplicatePublishes !== "boolean") throw Error("Invalid delivery queue profile/budget");
        n(r.capacityBytes, "bytes"); n(r.dlqBytes, "bytes"); micros(horizon + n(r.lease, "us", 1)); micros(horizon + n(r.retention, "us", 1));
        for (const c of r.consumers) if (!key(c.id) || n(c.credit, "count", 1) > caps.concurrency) throw Error("Invalid consumer credit");
      } else {
        if (r.profile !== "atomic-current-object/1" || r.initial.length > caps.objects || new Set(r.initial.map((o) => JSON.stringify([o.namespace, o.key]))).size !== r.initial.length) throw Error("Invalid object profile/inventory");
        let total = 0; for (const o of r.initial) { if (!key(o.namespace) || !key(o.key) || !key(o.content) || !Number.isSafeInteger(o.generation) || o.generation < 1) throw Error("Invalid initial object identity"); total += n(o.bytes, "bytes"); }
        if (!Number.isSafeInteger(total) || (r.capacity && total > n(r.capacity, "bytes"))) throw Error("Initial object byte capacity");
      }
    } else {
      if (resources.get(r.broker)?.kind !== "delivery-queue" || resources.get(r.store)?.kind !== "object-store" || !key(r.namespace)) throw Error("Missing async broker/store"); path(r.id, r.broker); path(r.id, r.store);
      if (r.kind === "async-publisher") { n(r.objectBytes, "bytes"); n(r.messageBytes, "bytes"); micros(horizon + n(r.delay, "us")); if (n(r.publishAttempts, "count", 1) > caps.attempts || !i.endpoints[r.id]!.alive || i.networkInterventions.some((f) => f.target === r.id)) throw Error("Publisher retry/process policy budget"); }
      else {
        if (n(r.concurrency, "count", 1) > caps.concurrency || n(r.prefetch, "count", 1) > caps.concurrency || !["none", "object-if-absent"].includes(r.idempotency) || r.poisonKeys.length > caps.messages || r.poisonKeys.some((k) => !key(k))) throw Error("Invalid consumer policy/budget");
        const broker = resources.get(r.broker); if (broker?.kind !== "delivery-queue" || !broker.consumers.some((c) => c.id === r.id && requireKnown(c.credit, "count") === requireKnown(r.prefetch, "count"))) throw Error("Worker/broker credit contract mismatch");
        n(r.cpu, "cpu-us", Number.MIN_VALUE, false); for (const value of [r.pollInterval, r.blockingWait, r.ackDelay]) micros(horizon + n(value, "us", value === r.pollInterval ? 1 : 0)); n(r.resultBytes, "bytes");
        if (!i.operations.some((o) => o.id === r.databaseOperation) || i.operations.some((o) => o.entry === r.id) || i.networkInterventions.some((f) => f.target === r.id)) throw Error("Invalid autonomous worker entry/fault policy");
        if (r.database) { const db = resources.get(r.database); if (db?.kind !== "relational" || !key(r.databaseKey) || !db.keys.includes(r.databaseKey) || !db.plans[r.databaseOperation] || r.idempotency !== "none") throw Error("Cross-resource idempotent transaction is unmodeled"); path(r.id, r.database); }
      }
    }
  }
  const ids = new Set<string>(), spans = new Map<string, number>();
  for (const f of [...i.asyncInterventions].sort((a, b) => requireKnown(a.at, "us") - requireKnown(b.at, "us"))) {
    const at = n(f.at, "us"), duration = n(f.duration, "us", 1), r = resources.get(f.target), group = JSON.stringify([f.kind, f.target]);
    if (!key(f.id) || ids.has(f.id) || at < (spans.get(group) ?? 0)) throw Error("Duplicate/overlapping async intervention"); ids.add(f.id); spans.set(group, micros(at + duration));
    if (f.kind === "consumer-state") { if (r?.kind !== "async-worker" || typeof f.available !== "boolean") throw Error("Consumer intervention target"); }
    else { if (r?.kind !== "object-store") throw Error("Object intervention target"); if (f.kind === "object-capacity") n(f.bytes, "bytes"); else if (typeof f.reads !== "boolean" || typeof f.writes !== "boolean") throw Error("Object access policy"); }
  }
}
