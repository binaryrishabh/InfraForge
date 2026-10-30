import { validateDataFlowEffects } from "./flowEffects";
import { requireKnown, type Quantity, type Unit } from "../../reality/quantity";
import { micros } from "../time";
import type { NetworkInput } from "../network/contracts";
import type { DataInput, DataResource } from "./contracts";
import { DATA_LIMITS as caps, POSTGRES_SESSION_CAP } from "./policy";
import { validateNetwork, computeAdapter } from "../network/validate";
import { validateComputeInput } from "../compute/run";
export const isData = (r: DataInput["resources"][number]): r is DataResource => ["relational", "cache", "cache-aside"].includes(r.kind);
export const networkAdapter = (input: DataInput): NetworkInput => ({ ...input, workloadVersion: "m2d/1", resources: input.resources.map((r) => isData(r) ? { ...r.execution, id: r.id, downstream: undefined } : r) });
export function validateData(input: DataInput) {
  validateDataFlowEffects(input);
  const adapter = networkAdapter(input); validateNetwork(adapter); validateComputeInput(computeAdapter(adapter));
  if (!["m2e/1", "m2e-pg/1", "m2e-pg/2"].includes(input.workloadVersion) || input.dataInterventions.length > caps.interventions) throw new Error("Invalid data revision/budget");
  const ledger = new Map(input.ledger.map((e) => [e.id, e.quantity])), horizon = requireKnown(input.horizon, "us");
  const num = <U extends Unit>(q: Quantity<U>, unit: U, min = 0, integer = true) => {
    const n = requireKnown(q, unit); if (n < min || (integer && !Number.isSafeInteger(n))) throw new Error(`Invalid data ${unit}`);
    for (const id of q.provenance) { const e = ledger.get(id); if (!e || e.kind !== "known" || e.unit !== unit || e.value !== n) throw new Error(`Missing data provenance ${id}`); } return n;
  };
  const resources = new Map(input.resources.map((r) => [r.id, r])), pairs = new Set(input.paths.map((p) => JSON.stringify([p.source, p.target])));
  const validKey = (key: string) => typeof key === "string" && key.length > 0 && key.length <= caps.keyCharacters;
  for (const r of input.resources) if (r.kind === "compute" && r.applicationFlow) for (const flow of Object.values(r.applicationFlow.operations)) for (const step of flow.steps) if (step.kind === "data") {
    const target = resources.get(step.target);
    if (step.command === "query" ? target?.kind !== "relational" : target?.kind !== "cache-aside") throw Error("Typed data target must own its declared command");
    const db = target?.kind === "cache-aside" ? resources.get(target.database) : target;
    if (target?.kind === "cache-aside" && (target.operations[step.operation] !== step.operation || !target.invalidateWrites)) throw Error("Typed cache operation must match cache-aside policy");
    if (db?.kind !== "relational") throw Error("Typed data requires a relational database");
    const plan = db.plans[step.operation];
    if (!plan || plan.statements.some(s => step.operation === "read" ? s.kind !== "snapshot-read" : !["snapshot-read", "write"].includes(s.kind))) throw Error("Typed data read/write must match existing snapshot-read/write plans");
  }
  for (const r of input.resources) if (isData(r)) {
    if (r.execution.id !== r.id || r.execution.downstream || r.execution.quota || input.interventions.some((i) => i.target === r.id) || input.faults.some((f) => f.target === r.id)) throw new Error("Data resource owns its execution/fault policy; unsupported generic intervention");
    if (r.execution.memory.coverage !== "partial" || r.execution.memory.policy !== "observe" || Object.keys(r.execution.memory).some((key) => !["coverage", "policy"].includes(key))) throw new Error("Data process memory is Unknown; generic compute memory policy is unsupported");
    if (r.kind === "cache-aside") {
      if (!r.keys.length || r.keys.length > caps.keys || r.keys.some((k) => !validKey(k)) || new Set(r.keys).size !== r.keys.length || !["cycle", "keyed-uniform"].includes(r.access) || !["fail", "database"].includes(r.onCacheFailure) || typeof r.coalesce !== "boolean" || typeof r.invalidateWrites !== "boolean") throw new Error("Invalid cache-aside key/policy");
      if (resources.get(r.cache)?.kind !== "cache" || resources.get(r.database)?.kind !== "relational" || !pairs.has(JSON.stringify([r.id, r.cache])) || !pairs.has(JSON.stringify([r.id, r.database]))) throw new Error("Missing cache-aside resource/path");
      for (const op of input.operations) if (!["read", "write"].includes(r.operations[op.id]!)) throw new Error("Missing authored cache-aside operation");
      if (input.networkInterventions.some((i) => i.target === r.id)) throw new Error("Cache-aside suspension/restart policy is unmodeled");
    } else {
      if (r.initial.length > caps.keys || new Set(r.initial.map((x) => x.key)).size !== r.initial.length) throw new Error("Invalid data inventory/budget");
      for (const row of r.initial) if (!validKey(row.key) || !Number.isSafeInteger(row.version) || row.version < 1 || !Number.isSafeInteger(num(row.bytes, "bytes") * caps.keys)) throw new Error("Invalid row/version/bytes");
      if (r.kind === "cache") {
        const size = num(r.capacity, "bytes"), overhead = num(r.entryOverhead, "bytes");
        if (r.semantics !== "keyed-cache/1" || !["lru", "no-eviction"].includes(r.policy) || r.initial.reduce((n, x) => n + num(x.bytes, "bytes") + overhead, 0) > size) throw new Error("Invalid initial cache budget/policy");
        micros(horizon + num(r.ttl, "us", 1)); num(r.commandCpu, "cpu-us", Number.MIN_VALUE, false);
      } else {
        const dataset = new Set(r.keys);
        if (!r.keys.length || r.keys.length > caps.keys || r.keys.some((k) => !validKey(k)) || dataset.size !== r.keys.length || r.initial.some((row) => !dataset.has(row.key))) throw new Error("Invalid bounded database dataset");
        if (r.semantics !== (input.workloadVersion === "m2e-pg/2" ? "postgresql-keyed/2" : input.workloadVersion === "m2e-pg/1" ? "postgresql-keyed/1" : "read-committed-keyed/1") || num(r.maxSessions, "count", 1) > (r.semantics.startsWith("postgresql-keyed/") ? POSTGRES_SESSION_CAP : caps.sessions) || num(r.activeTransactions, "count", 1) > caps.activeTransactions) throw new Error("Invalid relational policy/budget");
        num(r.pendingQueries, "count");
        for (const op of input.operations) {
          const p = r.plans[op.id]; if (!p || !p.statements.length || p.statements.length > caps.statements || !["logical-only", "authored-log-ack"].includes(p.durability)) throw new Error("Missing/bounded transaction plan");
          for (const t of [p.statementTimeout, p.lockTimeout, p.transactionTimeout]) micros(horizon + num(t, "us", r.semantics.startsWith("postgresql-keyed/") ? 0 : 1));
          micros(horizon + num(p.commitWait, "us")); if (p.durability === "logical-only" && requireKnown(p.commitWait, "us") !== 0) throw new Error("Logical commit cannot invent durability wait");
          for (const s of p.statements) {
            if (!["snapshot-read", "write", "insert", "lock-read"].includes(s.kind) || !s.keys.length || s.keys.length > caps.keysPerStatement || s.keys.some((k) => !validKey(k)) || new Set(s.keys).size !== s.keys.length) throw new Error("Invalid keyed statement");
            const demand = num(s.cpu, "cpu-us", Number.MIN_VALUE, false); num(s.parallelism, "cores", Number.MIN_VALUE, false); num(s.blockingWait, "us"); num(s.logBytes, "bytes");
            if (s.keys.some((k) => k !== "$key" && !dataset.has(k))) throw new Error("Statement outside logical dataset");
            if (s.kind === "insert") { if (!s.insertBytes) throw new Error("Insert needs authored row size"); num(s.insertBytes, "bytes"); }
            micros(horizon + Math.ceil(demand / requireKnown(r.execution.cores, "cores")) + requireKnown(s.blockingWait, "us"));
          }
        }
        for (const path of input.paths.filter((p) => p.target === r.id)) if (requireKnown(path.pool.streams, "count") !== 1) throw new Error("Relational session has one transaction at a time; multiplexing requires a future session policy");
      }
    }
  }
  const ids = new Set<string>(), spans = new Map<string, number>();
  for (const i of [...input.dataInterventions].sort((a, b) => requireKnown(a.at, "us") - requireKnown(b.at, "us"))) {
    if (!i.id || ids.has(i.id)) throw new Error("Duplicate data intervention"); ids.add(i.id); const at = num(i.at, "us"), r = resources.get(i.target);
    if (i.kind === "flush") { if (r?.kind !== "cache") throw new Error("Flush targets cache only"); }
    else {
      if (r?.kind !== "relational") throw new Error("Data capacity intervention requires relational resource");
      const key = JSON.stringify([i.kind, i.target]); if (at < (spans.get(key) ?? 0)) throw new Error("Overlapping data interventions"); spans.set(key, micros(at + num(i.duration, "us", 1)));
      if (i.kind === "session-capacity") { if (num(i.sessions, "count") > (r.semantics.startsWith("postgresql-keyed/") ? POSTGRES_SESSION_CAP : caps.sessions)) throw new Error("Session limit budget"); }
      else num(i.cores, "cores", 0, false);
    }
  }
}
