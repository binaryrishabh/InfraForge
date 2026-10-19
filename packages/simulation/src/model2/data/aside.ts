import type { Deliver } from "../compute/run";
import type { EventClock } from "../time";
import { keyedUniform } from "../random";
import type { Invocation, Receipt, RemoteOutcome } from "../workload/contracts";
import type { AsideConfig, DataRequest, DataReply } from "./contracts";
import { DATA_LIMITS } from "./policy";

export function cacheAside(config: AsideConfig, kernel: EventClock, send: Deliver, seed: string) {
  const live = new Map<string, { done(outcome: RemoteOutcome): void; work: Invocation; terminal: boolean }>();
  const fills = new Map<string, Array<(reply: DataReply | undefined) => void>>();
  let received = 0, completed = 0, failed = 0, cacheFailures = 0, fetches = 0, coalesced = 0, invalidations = 0;
  const results: Array<{ root: string; key: string; at: number; version?: number; source: string; ok: boolean }> = []; let omitted = 0;
  return {
    accept(work: Invocation, done: (outcome: RemoteOutcome) => void): Receipt {
      received++; let childSequence = 0; const owner = { work, done, terminal: false }; live.set(work.callId, owner);
      let ordinal = 0; try { const root = JSON.parse(work.rootId) as string[]; const row = root[2]!; ordinal = /^\d+$/.test(row) ? Number(row) : Number(JSON.parse(row).at(-1)) || 0; } catch { /* Non-workload proof roots use the first cycle key. */ }
      const key = (work.message?.request as DataRequest | undefined)?.key ?? config.keys[config.access === "cycle" ? ordinal % config.keys.length : Math.floor(keyedUniform(seed, config.id, work.rootId, "data-key") * config.keys.length)]!;
      const finish = (reply: DataReply | undefined, source: string) => {
        if (owner.terminal) return; owner.terminal = true; live.delete(work.callId); const ok = !!reply?.ok;
        if (ok) completed++; else failed++;
        if (work.message) work.message.response = reply;
        if (results.length < DATA_LIMITS.terminalRows) results.push({ root: work.rootId, key, at: kernel.now, version: reply?.version ?? reply?.rows?.[0]?.version, source, ok }); else omitted++;
        done(ok ? "completed" : "rejected");
      };
      const request = (target: string, body: DataRequest, next: (reply: DataReply | undefined) => void) => {
        const child: Invocation = { ...work, parentCallId: work.callId, callId: JSON.stringify([...JSON.parse(work.callId), "data", config.id, childSequence++, target]), message: { request: body } };
        send(target, child, (outcome) => next(outcome === "completed" ? child.message!.response as DataReply : undefined));
      };
      if (config.operations[work.operation] === "write") {
        fetches++; request(config.database, { kind: "query", key }, (reply) => {
          if (!reply?.ok || !config.invalidateWrites) { finish(reply, "database-write"); return; }
          request(config.cache, { kind: "invalidate", key }, (invalidated) => { if (invalidated?.ok) invalidations++; finish(reply, invalidated?.ok ? "write-invalidated" : "write-invalidation-failed"); });
        });
      } else request(config.cache, { kind: "get", key }, (cached) => {
        if (cached?.hit) { finish(cached, "cache-hit"); return; }
        if (!cached?.ok) { cacheFailures++; if (config.onCacheFailure === "fail") { finish(undefined, "cache-failed"); return; } }
        const ready = (reply: DataReply | undefined) => finish(reply, "database-fetch");
        if (config.coalesce && fills.has(key)) { coalesced++; fills.get(key)!.push(ready); return; }
        const waiters = [ready]; if (config.coalesce) fills.set(key, waiters);
        const complete = (reply: DataReply | undefined) => { if (config.coalesce) fills.delete(key); for (const waiter of waiters) waiter(reply); };
        fetches++; request(config.database, { kind: "query", key }, (reply) => {
          const row = reply?.rows?.find((r) => r.key === key);
          if (!reply?.ok || !row) { complete(reply); return; }
          if (!cached?.ok) { complete(reply); return; } // Failure fallback never fabricates a cache acknowledgement.
          request(config.cache, { kind: "set", key, row, token: cached.token }, () => complete(reply));
        });
      });
      // Application policy detaches from child work; caller cancellation cannot erase a fill.
      return { admitted: true, state: () => owner.terminal ? "finished" : "waiting", cancel: () => owner.terminal ? "already-finished" : "unsupported" };
    },
    pause() { throw new Error("Cache-aside process suspension is outside this policy"); },
    measure: () => ({ id: config.id, paused: false, received, admitted: received, rejected: 0, completed, failed, cancelled: 0, queued: 0, serving: 0, waiting: live.size, consumedCoreUs: 0, busySlotUs: 0 }),
    evidence: () => ({ id: config.id, received, completed, failed, live: live.size, databaseFetches: fetches, cacheFailures, coalescedWaiters: coalesced, fillsInProgress: fills.size, invalidations, results, omitted }),
  };
}
