import { carryCause, type Cause } from "../workload/cause";
import type { Deliver } from "../compute/run";
import type { EventClock } from "../time";
import { keyedUniform } from "../random";
import type { Invocation, Receipt, RemoteOutcome } from "../workload/contracts";
import type { AsideConfig, DataRequest, DataReply } from "./contracts";
import { DATA_LIMITS } from "./policy";

export function cacheAside(config: AsideConfig, kernel: EventClock, send: Deliver, seed: string) {
  const live = new Map<string, { done(outcome: RemoteOutcome, cause?: Cause): void; work: Invocation; terminal: boolean }>();
  const fills = new Map<string, Array<(reply: DataReply | undefined, cause?: Cause) => void>>();
  let hits = 0, misses = 0, fillAttempts = 0, fillAcknowledged = 0, fillRejected = 0;
  let received = 0, completed = 0, failed = 0, cacheFailures = 0, fetches = 0, coalesced = 0, invalidations = 0;
  const results: Array<{ root: string; key: string; at: number; version?: number; source: string; ok: boolean }> = []; let omitted = 0;
  return {
    accept(work: Invocation, done: (outcome: RemoteOutcome, cause?: Cause) => void): Receipt {
      const recorded = (work.message?.request as DataRequest | undefined)?.key;
      if (config.recordedKeysOnly && (!recorded || !config.keys.includes(recorded))) throw Error("Cache policy requires an exact recorded key; fallback is forbidden");
      received++; let childSequence = 0; const owner = { work, done, terminal: false }; live.set(work.callId, owner);
      let ordinal = 0; try { const root = JSON.parse(work.rootId) as string[]; const row = root[2]!; ordinal = /^\d+$/.test(row) ? Number(row) : Number(JSON.parse(row).at(-1)) || 0; } catch { /* Non-workload proof roots use the first cycle key. */ }
      const key = (work.message?.request as DataRequest | undefined)?.key ?? config.keys[config.access === "cycle" ? ordinal % config.keys.length : Math.floor(keyedUniform(seed, config.id, work.rootId, "data-key") * config.keys.length)]!;
      const finish = (reply: DataReply | undefined, source: string, cause?: Cause) => {
        if (owner.terminal) return; owner.terminal = true; live.delete(work.callId); const ok = !!reply?.ok;
        if (ok) completed++; else failed++;
        if (work.message) work.message.response = reply;
        if (results.length < DATA_LIMITS.terminalRows) results.push({ root: work.rootId, key, at: kernel.now, version: reply?.version ?? reply?.rows?.[0]?.version, source, ok }); else omitted++;
        done(ok ? "completed" : "rejected", !ok && cause ? carryCause(cause) : undefined);
      };
      const request = (target: string, body: DataRequest, next: (reply: DataReply | undefined, cause?: Cause) => void) => {
        const child: Invocation = { ...work, parentCallId: work.callId, callId: JSON.stringify([...JSON.parse(work.callId), "data", config.id, childSequence++, target]), message: { request: body } };
        send(target, child, (outcome, cause) => next(outcome === "completed" ? child.message!.response as DataReply : undefined, outcome === "completed" ? undefined : cause));
      };
      if (config.operations[work.operation] === "write") {
        fetches++; request(config.database, { kind: "query", key }, (reply, cause) => {
          if (!reply?.ok || !config.invalidateWrites) { finish(reply, "database-write", cause); return; }
          // New reads cannot join a fill that began before this committed write.
          if (config.recordedKeysOnly) fills.delete(key);
          request(config.cache, { kind: "invalidate", key }, (invalidated) => { if (invalidated?.ok) invalidations++; finish(reply, invalidated?.ok ? "write-invalidated" : "write-invalidation-failed"); });
        });
      } else request(config.cache, { kind: "get", key }, (cached, cacheCause) => {
        if (cached?.hit) { hits++; finish(cached, "cache-hit"); return; }
        if (cached?.ok) misses++;
        if (!cached?.ok) { cacheFailures++; if (config.onCacheFailure === "fail") { finish(undefined, "cache-failed", cacheCause); return; } }
        const ready = (reply: DataReply | undefined, cause?: Cause) => finish(reply, "database-fetch", cause);
        if (config.coalesce && fills.has(key)) { coalesced++; fills.get(key)!.push(ready); return; }
        const waiters = [ready]; if (config.coalesce) fills.set(key, waiters);
        const complete = (reply: DataReply | undefined, cause?: Cause) => { if (config.coalesce && (!config.recordedKeysOnly || fills.get(key) === waiters)) fills.delete(key); for (const waiter of waiters) waiter(reply, cause); };
        fetches++; request(config.database, { kind: "query", key }, (reply, cause) => {
          const row = reply?.rows?.find((r) => r.key === key);
          if (!reply?.ok || !row) { complete(reply, cause); return; }
          if (!cached?.ok) { complete(reply, cause); return; } // Failure fallback never fabricates a cache acknowledgement.
          fillAttempts++; request(config.cache, { kind: "set", key, row, token: cached.token }, (filled) => { if (filled?.ok) fillAcknowledged++; else fillRejected++; complete(reply); });
        });
      });
      // Application policy detaches from child work; caller cancellation cannot erase a fill.
      return { admitted: true, state: () => owner.terminal ? "finished" : "waiting", cancel: () => owner.terminal ? "already-finished" : "unsupported" };
    },
    pause() { throw new Error("Cache-aside process suspension is outside this policy"); },
    measure: () => ({ id: config.id, paused: false, received, admitted: received, rejected: 0, completed, failed, cancelled: 0, queued: 0, serving: 0, waiting: live.size, consumedCoreUs: 0, busySlotUs: 0 }),
    evidence: () => ({ id: config.id, received, completed, failed, live: live.size, databaseFetches: fetches, cacheFailures, coalescedWaiters: coalesced, fillsInProgress: fills.size, invalidations, results, omitted,
      ...(config.recordedKeysOnly ? { recordedKeys: { hits, misses, fillAttempts, fillAcknowledged, fillRejected, savedDatabaseReads: hits + coalesced, policyCpu: "Charged only through explicit app demand; this role owns no second CPU" } } : {}) }),
  };
}
