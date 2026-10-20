import { ioBudget, type IoHandle, type IoWork } from "../composition/io-budget";
import type { EventClock } from "../time";
import type { Invocation } from "../workload/contracts";
import { ioNumber as n, type FiniteIoProfile } from "./io-contract";

export interface DatabaseIo {
  resolve(work: Invocation): void;
  statement(work: Invocation, step: number, done: (ok: boolean) => void): () => void;
  commit(work: Invocation, done: (ok: boolean) => void): void;
}
// Profile admission happens before this factory allocates or schedules work.
export function finiteIoRuntime(authored: FiniteIoProfile, clock: EventClock) {
  const p: FiniteIoProfile = JSON.parse(JSON.stringify(authored));
  const devices = new Map(p.devices.map(d => [d.id, ioBudget({ id: d.id, generation: d.generation, policy: d.policy,
    queueOperations: n(d.queueOperations, "count"), queueBytes: n(d.queueBytes, "bytes"), serviceConcurrency: 1,
    iops: n(d.iops, "operations/s"), bytesPerSecond: n(d.bytesPerSecond, "bytes/s"), flushServiceUs: n(d.flushServiceUs, "us") }, clock, p.limits.maxReceipts)]));
  type Flight = { handle: IoHandle; waiters: Map<number, () => void> };
  const buffers = new Map(p.buffers.map(b => [b.owner, { config: b, pages: new Map(b.initialPages.map(page => [page, true])), flights: new Map<string, Flight>(), hits: 0, misses: 0, coalesced: 0, evictions: 0 }]));
  let receipts = 0, waiters = 0, sequence = 0, scheduledBackground = p.background.schedule.length, retired = false;
  const assertLive = () => { if (retired) throw Error("Retired finite IO owner"); };
  const submit = (device: string, work: IoWork, done: () => void, completeDetached = false) => {
    if (receipts >= p.limits.maxReceipts) throw Error("Executor global IO receipt budget exhausted; evidence is incomplete");
    const handle = devices.get(device)!.submit(work, done, completeDetached); if (handle.admitted) receipts++; return handle;
  };
  const select = (role: string, work: Invocation) => {
    assertLive();
    const request = work.message?.request as { keys?: string[]; key?: string } | undefined;
    const keys = request?.keys ?? (request?.key ? [request.key] : undefined);
    const matches = p.bindings.filter(b => b.role === role && b.operation === work.operation && keys && JSON.stringify(b.keys) === JSON.stringify(keys));
    if (matches.length !== 1) throw Error("Missing exact finite IO request key binding");
    return matches[0]!;
  };
  const workFor = (role: string, work: Invocation, operation: string, kind: IoWork["kind"], bytes: number): IoWork => ({ role, request: work.callId, transaction: work.callId, operation, kind, bytes });
  const forRole = (role: string): DatabaseIo => ({
    resolve(work) { select(role, work); },
    statement(work, step, done) {
      const binding = select(role, work), buffer = buffers.get(binding.buffer)!;
      let cancelled = false, index = 0, detach: (() => void) | undefined;
      const next = () => {
        if (cancelled) return;
        let page: string | undefined;
        while (true) {
          page = binding.statementPages[step]![index++];
          if (page === undefined) { done(true); return; }
          if (!buffer.pages.has(page)) break;
          buffer.hits++; buffer.pages.delete(page); buffer.pages.set(page, true);
        }
        buffer.misses++;
        if (waiters >= p.limits.maxReceipts) throw Error("Executor IO waiter budget exhausted; evidence is incomplete");
        const waiter = ++sequence; let flight = buffer.flights.get(page);
        if (flight) buffer.coalesced++;
        else {
          const callbacks = new Map<number, () => void>();
          const handle = submit(buffer.config.device, workFor(role, work, JSON.stringify(["page", step, index, page]), "page-read", n(buffer.config.pageBytes, "bytes")), () => {
            buffer.flights.delete(page);
            const capacity = n(buffer.config.capacityBytes, "bytes") / n(buffer.config.pageBytes, "bytes");
            if (buffer.pages.size === capacity) { buffer.pages.delete(buffer.pages.keys().next().value!); buffer.evictions++; }
            buffer.pages.set(page, true);
            const pending = [...callbacks.values()]; waiters -= callbacks.size; callbacks.clear();
            for (const callback of pending) callback();
          }, true);
          if (!handle.admitted) { done(false); return; }
          flight = { handle, waiters: callbacks }; buffer.flights.set(page, flight);
        }
        const owned = flight; owned.waiters.set(waiter, next); waiters++;
        detach = () => {
          if (!owned.waiters.delete(waiter)) return;
          waiters--;
          if (!owned.waiters.size) {
            // If already servicing, leave the completion installed (and permit
            // a later waiter to join). Queued work can be removed immediately.
            // Cancellation must preserve completion-side buffer installation for
            // started work, so only cancel a receipt that is still queued.
            const queued = owned.handle.state() === "queued";
            owned.handle.cancel(); if (queued) buffer.flights.delete(page);
          }
        };
      };
      next(); return () => { if (!cancelled) { cancelled = true; detach?.(); } };
    },
    commit(work, done) {
      const binding = select(role, work), buffer = buffers.get(binding.buffer)!;
      const bytes = n(binding.walBytes, "bytes"), operations = n(binding.walOperations, "count");
      let index = 0;
      const ack = binding.commitAck === "declared-local-wal-flush";
      // Once commit is entered, this chain belongs to the device and survives
      // caller cancellation, session close and logical-only acknowledgement.
      const next = () => {
        if (index < operations) {
          const part = Math.floor(bytes / operations) + (index < bytes % operations ? 1 : 0);
          const operation = index++;
          if (!submit(buffer.config.device, workFor(role, work, `wal-${operation}`, "wal-write", part), next).admitted) {
            if (ack) done(false); else throw Error("Logical WAL rejected after acknowledgement; evidence is incomplete");
          }
        } else if (ack) {
          if (!submit(buffer.config.device, workFor(role, work, "flush", "flush", 0), () => done(true)).admitted) done(false);
        }
      };
      next(); if (!ack) done(true);
    },
  });
  for (const s of p.background.schedule) clock.schedule(n(s.atUs, "us"), 0, JSON.stringify(["io-background", s.id]), () => {
    scheduledBackground--;
    // Rejection is retained in the device ledger; requested background coverage
    // then remains incomplete rather than being silently counted as performed.
    submit(s.device, { role: "$background", request: s.id, transaction: s.id, operation: s.id, kind: "background-write", bytes: n(s.bytes, "bytes") }, () => {});
  });
  return {
    forRole,
    liveFor(role: string) { return [...devices.values()].some(d => d.measure().receipts.some(r => r.role === role && (r.state === "queued" || r.state === "servicing"))); },
    retire() {
      if (scheduledBackground || waiters || [...buffers.values()].some(b => b.flights.size) || [...devices.values()].some(d => d.measure().queued.operations + d.measure().servicing.operations > 0)) throw Error("IO generation still owns live work");
      for (const d of devices.values()) d.retire(); retired = true;
    },
    evidence: () => ({ revision: p.schema, profile: JSON.parse(JSON.stringify(p)) as FiniteIoProfile, timing: "assumption-only", physicalHitRate: null, physicalHitRateReason: "Explicit logical pages do not identify physical PG/OS-cache hits",
      recovery: null, totalDemand: null, totalDemandReason: "Full process/device/background demand is not identified", background: p.background.policy, scheduledBackground, retired,
      devices: [...devices.values()].map(d => d.measure()), buffers: [...buffers.values()].map(b => ({ owner: b.config.owner, pages: [...b.pages.keys()], hits: b.hits, misses: b.misses, coalesced: b.coalesced, evictions: b.evictions, inFlight: b.flights.size })), waiters }),
  };
}
