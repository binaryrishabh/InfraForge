import { requireKnown } from "../../reality/quantity";
import { cpuScheduler } from "../compute/scheduler";
import type { EventKernel } from "../time";
import type { Invocation, Receipt, RemoteOutcome } from "../workload/contracts";
import type { CacheConfig, DataReply, DataRequest } from "./contracts";
import { DATA_LIMITS } from "./policy";
import { expireOwned, evictOwned } from "./cache-state";
interface Entry { version: number; bytes: number; expires: number; sequence: number }
interface Command { work: Invocation; done(outcome: RemoteOutcome): void; terminal: boolean }
export function keyedCache(config: CacheConfig, kernel: EventKernel) {
  const entries = new Map<string, Entry>(), generations = new Map<string, number>(), queue = new Map<string, Command>(), active = new Map<string, Command>();
  const cpu = cpuScheduler(config.id, requireKnown(config.execution.cores, "cores"), kernel), capacity = requireKnown(config.capacity, "bytes"), overhead = requireKnown(config.entryOverhead, "bytes");
  let epoch = 0, sequence = 0, used = 0, paused = false, received = 0, admitted = 0, rejected = 0, completed = 0, failed = 0, cancelled = 0, attemptedLookups = 0, lookupFailures = 0, lookupCancelled = 0, lookups = 0, hits = 0, misses = 0, fills = 0, evictions = 0, expirations = 0, invalidations = 0, staleFillRefused = 0, allocationRefused = 0;
  const token = (key: string) => JSON.stringify([epoch, generations.get(key) ?? 0]);
  let expirationCursor = entries.keys();
  let busyUs = 0, busyStart = kernel.now;
  const remove = (key: string) => { const e = entries.get(key); if (e) { used -= e.bytes + overhead; entries.delete(key); } };
  const expire = (key: string) => { if (expireOwned(entries, key, kernel.now, remove)) expirations++; };
  const finish = (c: Command, reply: DataReply, cancel = false) => {
    if (c.terminal) return; c.terminal = true;
    if (active.has(c.work.callId)) { busyUs += kernel.now - busyStart; cpu.remove(c.work.callId); } active.delete(c.work.callId); queue.delete(c.work.callId);
    if (cancel) cancelled++; else if (reply.ok) completed++; else failed++;
    if ((c.work.message?.request as DataRequest | undefined)?.kind === "get" && !reply.ok) { if (cancel) lookupCancelled++; else lookupFailures++; }
    if (c.work.message) c.work.message.response = reply;
    c.done(cancel ? "cancelled" : reply.ok ? "completed" : "rejected"); pump();
  };
  const apply = (request: DataRequest): DataReply => {
    if (!request || typeof request.key !== "string" || !request.key.length || request.key.length > DATA_LIMITS.keyCharacters) return { ok: false, reason: "invalid-cache-key" };
    expire(request.key);
    if (request.kind === "get") { lookups++; const e = entries.get(request.key); if (e) { hits++; e.sequence = sequence++; entries.delete(request.key); entries.set(request.key, e); return { ok: true, hit: true, key: request.key, version: e.version, bytes: e.bytes, token: token(request.key) }; } misses++; return { ok: true, hit: false, key: request.key, token: token(request.key) }; }
    if (request.kind === "invalidate") { if (!generations.has(request.key) && generations.size >= DATA_LIMITS.keys) return { ok: false, reason: "key-budget" }; remove(request.key); generations.set(request.key, (generations.get(request.key) ?? 0) + 1); invalidations++; return { ok: true }; }
    if (request.kind !== "set" || !request.row) return { ok: false, reason: "unsupported-cache-command" };
    if (!Number.isSafeInteger(request.row.bytes) || request.row.bytes < 0 || !Number.isSafeInteger(request.row.version) || request.row.version < 1) return { ok: false, reason: "invalid-cache-row" };
    if (request.token !== undefined && request.token !== token(request.key)) { staleFillRefused++; return { ok: false, reason: "invalidated-fill" }; }
    // Lazy removal is an execution policy. Observation never expires/mutates entries.
    for (let i = 0; i < DATA_LIMITS.expirationScan; i++) { const next = expirationCursor.next(); if (next.done) { expirationCursor = entries.keys(); break; } expire(next.value); }
    const bytes = request.row.bytes + overhead, existing = entries.get(request.key), required = used - (existing ? existing.bytes + overhead : 0) + bytes;
    if (bytes > capacity || (!existing && entries.size >= DATA_LIMITS.keys) || (required > capacity && config.policy === "no-eviction")) { allocationRefused++; return { ok: false, reason: "cache-capacity" }; }
    remove(request.key);
    evictOwned(entries, () => used + bytes <= capacity, (key, entry) => { const expired = entry.expires <= kernel.now; remove(key); if (expired) expirations++; else evictions++; });
    entries.set(request.key, { ...request.row, expires: kernel.now + requireKnown(config.ttl, "us"), sequence: sequence++ }); used += bytes; fills++; return { ok: true };
  };
  const pump = () => {
    if (paused || active.size || !queue.size) return;
    const c = queue.values().next().value!; queue.delete(c.work.callId); active.set(c.work.callId, c); busyStart = kernel.now;
    cpu.add({ id: c.work.callId, demand: requireKnown(config.commandCpu, "cpu-us"), cap: 1, done: () => finish(c, apply(c.work.message?.request as DataRequest)) });
  };
  for (const row of config.initial) { const bytes = requireKnown(row.bytes, "bytes"); entries.set(row.key, { version: row.version, bytes, expires: requireKnown(config.ttl, "us"), sequence: sequence++ }); used += bytes + overhead; }
  return {
    accept(work: Invocation, done: Command["done"]): Receipt {
      received++;
      const isLookup = (work.message?.request as DataRequest | undefined)?.kind === "get"; if (isLookup) attemptedLookups++;
      if (paused || (active.size && queue.size >= requireKnown(config.execution.queueCapacity, "count"))) { rejected++; if (isLookup) lookupFailures++; done("rejected"); return { admitted: false, state: () => "finished", cancel: () => "already-finished" }; }
      admitted++; const c = { work, done, terminal: false }; queue.set(work.callId, c); pump();
      return { admitted: true, state: () => c.terminal ? "finished" : queue.has(work.callId) ? "queued" : "serving", cancel() { if (c.terminal) return "already-finished"; finish(c, { ok: false, reason: "cancelled" }, true); return "cancelled"; } };
    },
    flush() { entries.clear(); generations.clear(); used = 0; epoch++; },
    pause(value: boolean) { paused = value; cpu.pause(value); if (value) for (const c of [...active.values(), ...queue.values()]) finish(c, { ok: false, reason: "cache-unavailable" }); else pump(); },
    measure: () => ({ id: config.id, paused, received, admitted, rejected, completed, failed, cancelled, queued: queue.size, serving: active.size, waiting: 0, consumedCoreUs: cpu.measure().appCoreUs, busySlotUs: busyUs + (active.size ? kernel.now - busyStart : 0) }),
    evidence: () => ({ id: config.id, lookups: attemptedLookups, executedLookups: lookups, lookupFailures, lookupCancelled, liveLookups: [...active.values(), ...queue.values()].filter((c) => (c.work.message?.request as DataRequest | undefined)?.kind === "get").length, hits, misses, fills, evictions, expirations, invalidations, staleFillRefused, allocationRefused, epoch, allocatedEntryBytes: used, capacityBytes: capacity,
      entries: [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, e]) => ({ key, ...e, expired: e.expires <= kernel.now })), logicallyLiveEntries: [...entries.values()].filter((e) => e.expires > kernel.now).length, cpu: cpu.measure(), residentProcessBytes: "Unknown; entry budget excludes unmodeled runtime/allocator/native state" }),
  };
}
