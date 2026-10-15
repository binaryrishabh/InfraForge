import { requireKnown } from "../../reality/quantity";
import { messageClient } from "../async/client";
import { expireOwned, evictOwned } from "../data/cache-state";
import type { ObjectReply } from "../async/contracts";
import type { Deliver } from "../compute/run";
import type { EventKernel } from "../time";
import type { Invocation, Receipt } from "../workload/contracts";
import type { CdnConfig } from "./contracts";
import { systemService, type Reply } from "./service";
import { SYSTEM_LIMITS } from "./policy";
interface Cached { bytes: number; content: string; generation: number; expires: number; cancel(): boolean }
interface Fill { key: string; epoch: number; generation: number; waiters: Map<string, { work: Invocation; done(reply: Reply): void }>; receipt?: Receipt }
export function objectCdn(config: CdnConfig, kernel: EventKernel, send: Deliver) {
  const entries = new Map<string, Cached>(), fills = new Map<string, Fill>(), generations = new Map<string, number>();
  let bytes = 0, epoch = 0, hits = 0, misses = 0, originRequests = 0, originFailures = 0, stored = 0, replaced = 0, evictions = 0, expirations = 0, purged = 0, coalesced = 0, uncacheable = 0, staleFills = 0, responseBytes = 0;
  const remove = (key: string) => { const e = entries.get(key); if (e) { e.cancel(); bytes -= e.bytes; entries.delete(key); } };
  const service = systemService(config.id, config, kernel, (work, done) => {
    const request = work.message?.request as { kind?: string; key?: string; method?: string } | undefined, key = request?.key ?? config.keys[work.operation];
    if (typeof key !== "string" || !key || key.length > SYSTEM_LIMITS.textCharacters || (request?.method && request.method !== "GET")) { done({ ok: false, reason: "cdn-get-only" }); return; }
    if (expireOwned(entries, key, kernel.now, remove)) expirations++;
    const entry = entries.get(key);
    if (entry) { hits++; entries.delete(key); entries.set(key, entry); responseBytes += entry.bytes; if (work.message) work.message.bodyBytes = { response: entry.bytes }; done({ ok: true, bytes: entry.bytes, content: entry.content, generation: entry.generation } as Reply); return; }
    misses++; const fillId = config.coalesce ? key : work.callId, existing = fills.get(fillId);
    if (existing && existing.waiters.size >= requireKnown(config.maxWaiters, "count")) { done({ ok: false, reason: "cdn-waiter-capacity" }); return; }
    if (!existing && fills.size >= SYSTEM_LIMITS.entries) { done({ ok: false, reason: "cdn-fill-budget" }); return; }
    const fill: Fill = existing ?? { key, epoch, generation: generations.get(key) ?? 0, waiters: new Map() }; fill.waiters.set(work.callId, { work, done });
    if (existing) coalesced++;
    else {
      fills.set(fillId, fill); originRequests++; const ask = messageClient(work, send);
      fill.receipt = ask<ObjectReply>(config.origin, { kind: "get", namespace: config.namespace, key }, (reply, outcome) => {
        if (fills.get(fillId) !== fill) return; fills.delete(fillId); const object = outcome === "completed" && reply?.ok ? reply.object : undefined;
        if (!object) originFailures++;
        else if (fill.epoch !== epoch || fill.generation !== (generations.get(key) ?? 0)) staleFills++;
        else if (object.bytes > requireKnown(config.capacity, "bytes") || !requireKnown(config.ttl, "us")) uncacheable++;
        else {
          if (entries.has(key)) { remove(key); replaced++; }
          evictOwned(entries, () => bytes + object.bytes <= requireKnown(config.capacity, "bytes") && entries.size < SYSTEM_LIMITS.entries, (old) => { remove(old); evictions++; });
          const cached: Cached = { bytes: object.bytes, content: object.content, generation: object.generation, expires: kernel.now + requireKnown(config.ttl, "us"), cancel: () => false };
          cached.cancel = kernel.schedule(cached.expires, 0, JSON.stringify(["cdn-expire", config.id, key, stored]), () => { if (entries.get(key) === cached) { remove(key); expirations++; } }); entries.set(key, cached); bytes += cached.bytes; stored++;
        }
        for (const waiter of [...fill.waiters.values()]) {
          if (object) { responseBytes += object.bytes; if (waiter.work.message) waiter.work.message.bodyBytes = { response: object.bytes }; waiter.done({ ok: true, bytes: object.bytes, content: object.content, generation: object.generation } as Reply); }
          else waiter.done({ ok: false, reason: "origin-failed" });
        }
        fill.waiters.clear();
      });
    }
    return () => { fill.waiters.delete(work.callId); if (!fill.waiters.size && fills.get(fillId) === fill) { fills.delete(fillId); fill.receipt?.cancel(); } };
  });
  return { ...service, accept(work: Invocation, done: Parameters<typeof service.accept>[1]) { work.message ??= { request: { kind: "get", key: config.keys[work.operation] } }; return service.accept(work, done); }, purge(key?: string) {
    if (key === undefined) { epoch++; for (const k of [...entries.keys()]) { remove(k); purged++; } generations.clear(); }
    else { if (!generations.has(key) && generations.size >= SYSTEM_LIMITS.entries) throw Error("CDN invalidation budget"); generations.set(key, (generations.get(key) ?? 0) + 1); if (entries.has(key)) { remove(key); purged++; } }
  }, evidence: () => ({ id: config.id, hits, misses, originRequests, originFailures, fills: stored, replaced, evictions, expirations, purged, coalesced, uncacheable, staleFills, generatedResponseBodyBytes: responseBytes, storedBytes: bytes, entries: [...entries.entries()].map(([key, e]) => ({ key, bytes: e.bytes, content: e.content, generation: e.generation, expiresAt: e.expires })), pendingFills: [...fills.values()].map((f) => ({ key: f.key, waiters: f.waiters.size })), service: service.serviceEvidence() }) };
}
