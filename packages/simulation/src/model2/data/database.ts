import { requireKnown } from "../../reality/quantity";
import { cpuScheduler } from "../compute/scheduler";
import type { EventClock } from "../time";
import type { Invocation, Receipt, RemoteOutcome } from "../workload/contracts";
import type { RelationalConfig, DataRequest, DataReply, TransactionPlan } from "./contracts";
import { lockManager } from "./locks";
import type { CausalObserver } from "../workload/causal";
import type { DatabaseIo } from "./io";

interface Tx { work: Invocation; plan: TransactionPlan; step: number; phase: "queued" | "lock" | "cpu" | "io" | "wait" | "commit"; terminal: boolean; phaseAt: number; writes: Map<string, { version: number; bytes: number }>; rows: DataReply["rows"]; cancelTx?: () => boolean; cancelStatement?: () => boolean; cancelLock?: () => boolean; cancelWait?: () => boolean; cancelIo?: () => void; done(outcome: RemoteOutcome): void; session: string }
export function relationalDatabase(config: RelationalConfig, kernel: EventClock, causal?: CausalObserver, ownedCpu?: ReturnType<typeof cpuScheduler>, io?: DatabaseIo) {
  const pg = config.semantics === "postgresql-keyed/1";
  if (io && !pg) throw Error("Finite IO requires PostgreSQL session semantics");
  const cpu = ownedCpu ?? cpuScheduler(config.id, requireKnown(config.execution.cores, "cores"), kernel), locks = lockManager();
  const rows = new Map(config.initial.map((r) => [r.key, { version: r.version, bytes: requireKnown(r.bytes, "bytes") }]));
  const keyspace = new Set(config.keys);
  const phaseUs = { queued: 0, lock: 0, cpu: 0, io: 0, wait: 0, commit: 0 }, phaseEntries = { ...phaseUs };
  const phase = (t: Tx, next: Tx["phase"]) => {
    if (io) { phaseUs[t.phase] += kernel.now - t.phaseAt; phaseEntries[next]++; }
    t.phaseAt = kernel.now; t.phase = next;
  };
  const sessions = new Map<string, Tx | undefined>(), active = new Map<string, Tx>(), queue = new Map<string, Tx>();
  let activeArea = 0, activeAnchor = kernel.now;
  const settleActive = () => { activeArea += active.size * (kernel.now - activeAnchor); activeAnchor = kernel.now; };
  const byClass = new Map<string, { admitted: number; committed: number; aborted: number; cancelled: number }>();
  let sessionLimit = requireKnown(config.maxSessions, "count"), paused = false, received = 0, rejected = 0, admitted = 0, committed = 0, aborted = 0, cancelled = 0, statements = 0, logicalReads = 0, logicalWrites = 0, logBytes = 0, durableCommits = 0, pumping = false;
  const reasons: Record<string, number> = {};
  const sessionEvents = { established: 0, refused: 0, closed: 0, transactionTerminated: 0, protectedCommitCancels: 0 };
  const openSession = (id: string) => {
    if (sessions.has(id)) return true;
    if (paused || sessions.size >= sessionLimit) { sessionEvents.refused++; return false; }
    sessions.set(id, undefined); sessionEvents.established++; return true;
  };
  const finish = (t: Tx, ok: boolean, reason = "", cancel = false) => {
    if (t.terminal) return; t.terminal = true; t.cancelTx?.(); t.cancelStatement?.(); t.cancelLock?.(); t.cancelWait?.(); t.cancelIo?.();
    if (io) phaseUs[t.phase] += kernel.now - t.phaseAt;
    if (t.phase === "cpu") cpu.remove(t.work.callId);
    settleActive(); active.delete(t.work.callId); queue.delete(t.work.callId); if (sessions.get(t.session) === t) sessions.set(t.session, undefined);
    byClass.get(t.work.operation)![ok ? "committed" : cancel ? "cancelled" : "aborted"]++;
    if (ok) { for (const [key, row] of t.writes) rows.set(key, row); committed++; logicalWrites += t.writes.size; if (t.plan.durability === "authored-log-ack") durableCommits++; }
    else { if (cancel) cancelled++; else aborted++; reasons[reason] = (reasons[reason] ?? 0) + 1; }
    causal?.({ atUs: kernel.now, kind: "db-terminal", resource: config.id, work: t.work, detail: { session: t.session, outcome: ok ? "committed" : cancel ? "cancelled" : "aborted", reason, writes: ok ? t.writes.size : 0 } });
    if (pg && reason === "transaction-timeout") { sessions.delete(t.session); sessionEvents.transactionTerminated++; }
    if (t.work.message) t.work.message.response = { ok, rows: t.rows, durable: ok && t.plan.durability === "authored-log-ack", ...(reason ? { reason } : {}) } satisfies DataReply;
    locks.release(t.work.callId); t.done(ok ? "completed" : cancel ? "cancelled" : "rejected"); pump();
  };
  const deadline = (t: Tx, kind: "statement" | "lock" | "transaction", step = t.step) => {
    const duration = requireKnown(t.plan[`${kind}Timeout`], "us");
    if (pg && duration === 0) return undefined;
    if (pg && kind === "lock") {
      const statement = requireKnown(t.plan.statementTimeout, "us");
      if (statement > 0 && statement <= duration) return undefined;
    }
    if (pg && kind === "statement" && active.has(t.work.callId)) {
      const transaction = requireKnown(t.plan.transactionTimeout, "us");
      if (transaction > 0 && transaction <= duration) return undefined;
    }
    return kernel.schedule(kernel.now + duration, 1, JSON.stringify(kind === "transaction" ? ["db-transaction-timeout", config.id, t.work.callId] : [`db-${kind}-timeout`, config.id, t.work.callId, step]), () => {
      // PostgreSQL holds interrupts across its irreversible commit section.
      if (pg && t.phase === "commit") return;
      finish(t, false, `${kind}-timeout`);
    });
  };
  const execute = (t: Tx) => {
    if (t.terminal) return;
    if (!pg || t.step > 0 || t.step === t.plan.statements.length) t.cancelStatement?.(); t.cancelLock?.();
    if (t.step === t.plan.statements.length) {
      if (pg) causal?.({ atUs: kernel.now, kind: "db-commit-protected", resource: config.id, work: t.work, detail: { session: t.session } });
      phase(t, "commit");
      if (io) io.commit(t.work, ok => { t.cancelWait = kernel.schedule(kernel.now, 2, JSON.stringify(["db-io-commit", config.id, t.work.callId]), () => finish(t, ok, ok ? "" : "io-queue-full")); });
      else t.cancelWait = kernel.schedule(kernel.now + requireKnown(t.plan.commitWait, "us"), 2, JSON.stringify(["db-commit", config.id, t.work.callId]), () => finish(t, true));
      return;
    }
    const s = t.plan.statements[t.step]!, key = (t.work.message?.request as DataRequest | undefined)?.key;
    const keys = s.keys.map((k) => k === "$key" ? key! : k);
    if (keys.some((k) => !keyspace.has(k))) { finish(t, false, "key-outside-dataset"); return; }
    const observe = () => keys.flatMap((k) => { const row = t.writes.get(k) ?? rows.get(k); return row ? [{ key: k, ...row }] : s.kind === "insert" ? [{ key: k, version: 0, bytes: requireKnown(s.insertBytes!, "bytes") }] : []; });
    const snapshot = observe();
    // The first PG command's deadline includes the authored DB admission queue.
    if (!pg || t.step > 0) t.cancelStatement = deadline(t, "statement");
    const service = () => {
      if (t.terminal) return; t.cancelLock?.(); phase(t, "cpu");
      const observed = s.kind === "snapshot-read" ? snapshot : observe();
      cpu.add({ id: t.work.callId, demand: requireKnown(s.cpu, "cpu-us"), cap: requireKnown(s.parallelism, "cores"), done() {
        if (t.terminal) return;
        const block = () => { phase(t, "wait"); t.cancelWait = kernel.schedule(kernel.now + requireKnown(s.blockingWait, "us"), 2, JSON.stringify(["db-blocking", config.id, t.work.callId, t.step]), () => {
          if (s.kind === "insert" && observed.some((r) => r.version > 0)) { finish(t, false, "unique-conflict"); return; }
          if (s.kind === "write" || s.kind === "insert") { for (const row of observed) t.writes.set(row.key, { version: row.version + 1, bytes: row.bytes }); logBytes += requireKnown(s.logBytes, "bytes"); }
          else { logicalReads += observed.length; t.rows = observed; }
          causal?.({ atUs: kernel.now, kind: "db-statement", resource: config.id, work: t.work, detail: { session: t.session, step: t.step, statement: s.kind, pendingWrites: t.writes.size } });
          statements++; t.step++; execute(t);
        }); };
        if (io) { phase(t, "io"); t.cancelIo = io.statement(t.work, t.step, ok => { if (t.terminal) return; if (ok) block(); else finish(t, false, "io-queue-full"); }); }
        else block();
      } });
    };
    if (s.kind === "snapshot-read") service(); else {
      phase(t, "lock"); if (!pg) t.cancelLock = deadline(t, "lock");
      let index = 0; const acquire = () => {
        if (t.terminal) return;
        if (pg) t.cancelLock?.();
        if (index === keys.length) service(); else {
          if (pg) t.cancelLock = deadline(t, "lock", index);
          locks.acquire(t.work.callId, keys[index++]!, s.kind === "lock-read" ? "shared" : "exclusive", acquire, () => finish(t, false, "deadlock-requester-victim"));
        }
      }; acquire();
    }
  };
  const pump = () => {
    if (pumping || paused) return; pumping = true;
    while (queue.size && active.size < requireKnown(config.activeTransactions, "count")) {
      const t = queue.values().next().value!; queue.delete(t.work.callId); settleActive(); active.set(t.work.callId, t);
      if (pg) {
        t.cancelTx = deadline(t, "transaction");
        const transaction = requireKnown(t.plan.transactionTimeout, "us"), statement = requireKnown(t.plan.statementTimeout, "us");
        if (transaction > 0 && transaction <= statement) t.cancelStatement?.();
      }
      execute(t);
    }
    pumping = false;
  };
  return {
    openSession,
    sessionAlive: (id: string) => sessions.has(id),
    accept(work: Invocation, done: (outcome: RemoteOutcome) => void): Receipt {
      io?.resolve(work);
      received++; const session = work.sessionId ?? work.callId;
      if (paused || (pg && !sessions.has(session)) || (!sessions.has(session) && sessions.size >= sessionLimit) || sessions.get(session) || (active.size >= requireKnown(config.activeTransactions, "count") && queue.size >= requireKnown(config.pendingQueries, "count"))) {
        rejected++; const reason = paused ? "database-unavailable" : pg && !sessions.has(session) ? "session-not-established" : sessions.get(session) ? "session-busy" : !sessions.has(session) && sessions.size >= sessionLimit ? "session-limit" : "query-queue-full"; reasons[reason] = (reasons[reason] ?? 0) + 1; causal?.({ atUs: kernel.now, kind: "db-rejected", resource: config.id, work, detail: { session, reason } }); done("rejected"); return { admitted: false, state: () => "finished", cancel: () => "already-finished" };
      }
      sessions.set(session, undefined); admitted++;
      causal?.({ atUs: kernel.now, kind: "db-admitted", resource: config.id, work, detail: { session } });
      const counts = byClass.get(work.operation) ?? { admitted: 0, committed: 0, aborted: 0, cancelled: 0 }; counts.admitted++; byClass.set(work.operation, counts);
      const t: Tx = { work, done, plan: config.plans[work.operation]!, step: 0, phase: "queued", phaseAt: kernel.now, terminal: false, writes: new Map(), rows: [], session };
      if (io) phaseEntries.queued++;
      sessions.set(session, t); queue.set(work.callId, t);
      if (pg) t.cancelStatement = deadline(t, "statement"); else t.cancelTx = deadline(t, "transaction"); pump();
      return { admitted: true, state: () => t.terminal ? "finished" : t.phase === "queued" ? "queued" : t.phase === "lock" ? "waiting" : "serving", cancel() { if (t.terminal) return "already-finished"; if (pg && t.phase === "commit") { sessionEvents.protectedCommitCancels++; return "unsupported"; } finish(t, false, "cancelled", true); return "cancelled"; } };
    },
    closeSession(id: string) { const tx = sessions.get(id); if (sessions.delete(id)) sessionEvents.closed++; if (tx && !(pg && tx.phase === "commit")) finish(tx, false, "connection-closed"); },
    pause(value: boolean) { paused = value; cpu.pause(value); if (value) { for (const t of [...active.values(), ...queue.values()]) if (!(pg && t.phase === "commit")) finish(t, false, "database-unavailable"); if (pg) sessionEvents.closed += sessions.size; sessions.clear(); } else pump(); },
    capacity(value: number) { cpu.capacity(value); }, sessionCapacity(value: number) { sessionLimit = value; },
    measure: () => ({ id: config.id, paused, received, admitted, rejected, completed: committed, failed: aborted, cancelled, queued: queue.size, serving: [...active.values()].filter((t) => t.phase !== "lock").length, waiting: [...active.values()].filter((t) => t.phase === "lock").length, consumedCoreUs: cpu.measure().appCoreUs, busySlotUs: activeArea + active.size * (kernel.now - activeAnchor) }),
    evidence: () => ({ id: config.id, ...(io ? { ioProfile: "postgresql-keyed-io/1", ioPhases: {
      elapsedUs: Object.fromEntries(Object.entries(phaseUs).map(([name, elapsed]) => [name, elapsed + [...active.values(), ...queue.values()].filter(t => t.phase === name).reduce((n, t) => n + kernel.now - t.phaseAt, 0)])),
      entries: { ...phaseEntries }, note: "Transaction phase durations/populations; CPU phase includes scheduler contention, IO phase includes coalesced waiting. Device queue/service receipts remain separate; pool wait belongs to transport." } } : {}), ...(pg ? { profile: "postgresql-keyed/1", sessionEvents: { ...sessionEvents }, timing: "assumption-only", queryAdmission: "authored gate; not a PostgreSQL server setting" } : {}), sessions: { total: sessions.size, active: [...sessions.values()].filter(Boolean).length, idle: [...sessions.values()].filter((s) => !s).length, limit: sessionLimit }, transactions: { admitted, committed, aborted, cancelled, live: active.size + queue.size }, statements, logicalReads, logicalWrites, generatedLogBytes: logBytes, durableAcknowledgedCommits: durableCommits,
      rows: [...rows].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => ({ key, ...value })), locks: locks.measure(), waiters: locks.waiters(), cpu: cpu.measure(), reasons: { ...reasons }, queryClasses: Object.fromEntries([...byClass].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)), queries: { executingCpu: [...active.values()].filter((t) => t.phase === "cpu").length, lockWaiting: [...active.values()].filter((t) => t.phase === "lock").length, blockingWait: [...active.values()].filter((t) => t.phase === "wait").length, committing: [...active.values()].filter((t) => t.phase === "commit").length }, active: [...active.values()].map((t) => ({ id: t.work.callId, session: t.session, operation: t.work.operation, step: t.step, phase: t.phase, pendingWrites: t.writes.size })), queued: queue.size, physicalBufferHits: "Unknown", storageDeviceLatency: "Unknown" }),
  };
}
