import { requireKnown } from "../../reality/quantity";
import type { Deliver } from "../compute/run";
import type { Invocation, Receipt } from "../workload/contracts";
import type { EventKernel } from "../time";
import type { ConnectionHook, FailureReason, PathConfig, Trace, TransportResult } from "./contracts";
import type { networkLink } from "./link";
import { connectionPool, type Lease } from "./pool";

export function pathTransport(config: PathConfig, kernel: EventKernel, links: Map<string, ReturnType<typeof networkLink>>, deliver: Deliver, alive: (id: string) => boolean, trace: Trace, disconnected?: (session: string, target: string) => void, hook?: ConnectionHook, callBudget?: { enter(): () => void }) {
  const targets = new Map<string, string>();
  const pool = connectionPool(config.id, config.pool, kernel, (route = config) => alive(route.target) && [...route.request, ...route.response].every((id) => links.get(id)!.reachable()), (kind, id, detail, root, attempt, poolEvidence) => { trace(kind, id, detail, root, attempt, poolEvidence); if (kind === "connection-closed") { disconnected?.(id, targets.get(id) ?? config.target); targets.delete(id); } }, hook);
  let offered = 0, completed = 0, failed = 0, cancelled = 0, remoteAfterStop = 0, live = 0;
  const reasons: Record<string, number> = {}, latency = { connectionWaitUs: 0, requestTransportUs: 0, remoteServiceUs: 0, responseTransportUs: 0 };
  return {
    exchange(work: Invocation, done: (result: TransportResult) => void): Receipt {
      const releaseCall = callBudget?.enter();
      offered++; live++; const start = kernel.now, key = work.callId;
      trace("path-offered", key, `${config.id}:${work.operation}:request=${requireKnown(config.bytes[work.operation]!.request, "bytes")}:response=${requireKnown(config.bytes[work.operation]!.response, "bytes")}`, work.rootId, work.attempt);
      let terminal = false, delivered = false, remoteFinished = false, heldAfterStop = false, state: ReturnType<Receipt["state"]> = "queued", lease: Lease | undefined, remote: Receipt | undefined;
      let cancelAcquire: (() => boolean) | undefined, cancelTimeout: (() => boolean) | undefined, cancelTransfer: (() => boolean) | undefined;
      const finish = (result: TransportResult, isCancellation = false) => {
        if (terminal) return; terminal = true; releaseCall?.(); state = "finished"; live--; cancelAcquire?.(); cancelTimeout?.(); cancelTransfer?.();
        if (result.ok) completed++; else if (isCancellation) cancelled++; else { failed++; reasons[result.reason!] = (reasons[result.reason!] ?? 0) + 1; }
        trace("transport-terminal", key, result.ok ? "completed" : isCancellation ? "cancelled" : result.reason!, work.rootId, work.attempt);
        heldAfterStop = !!hook?.holdLeaseUntilRemoteTerminal && isCancellation && !!remote && !remoteFinished;
        if (!result.ok && !isCancellation && ["response-timeout", "reset", "drained"].includes(result.reason!)) lease?.fail(result.reason!); else if (!heldAfterStop) lease?.release();
        if (!result.ok && delivered && config.pool.remoteCancellation === "request-cancellation") remote?.cancel();
        done(result);
      };
      let endpoints = { origin: config.source, destination: config.target };
      const sendBytes = (ids: string[], bytes: number, direction: "request" | "response", end: () => void) => {
        let hop = 0;
        const next = () => {
          if (terminal) return;
          if (hop === ids.length) { end(); return; }
          const index = hop++, link = links.get(ids[index]!)!;
          cancelTransfer = link.transmit(JSON.stringify([key, direction, index]), bytes, (outcome) => {
            if (terminal) return;
            trace("transfer", key, `${direction}:${ids[index]}:${outcome}`, work.rootId, work.attempt);
            if (outcome === "delivered") next();
            else if (outcome === "overflow") finish({ ok: false, reason: "link-overflow", ambiguous: delivered });
            // Partition silently discards modeled messages. Only the owning timeout detects it.
          }, { path: config.id, direction, hop: index, origin: direction === "request" ? endpoints.origin : endpoints.destination, destination: direction === "request" ? endpoints.destination : endpoints.origin, callId: work.callId, rootId: work.rootId, attempt: work.attempt });
        }; next();
      };
      const totalBytes = (envelope: number, body = 0) => { const total = envelope + body; if (!Number.isSafeInteger(body) || body < 0 || !Number.isSafeInteger(total)) throw new Error("Invalid logical message body size"); return total; };
      cancelAcquire = pool.acquire(key, (acquired) => {
        if (terminal) { acquired.release(); return; }
        lease = acquired; const route = acquired.route ?? config; endpoints = { origin: config.source, destination: route.target }; targets.set(acquired.connection, route.target); state = "serving"; const readyAt = kernel.now; latency.connectionWaitUs += readyAt - start;
        trace("connection-acquired", key, acquired.connection, work.rootId, work.attempt, !!config.pool.evidenceProfile);
        cancelTimeout = kernel.schedule(kernel.now + requireKnown(config.pool.responseTimeout, "us"), 1, JSON.stringify(["upstream-timeout", config.id, key]), () => finish({ ok: false, reason: "response-timeout", ambiguous: delivered }));
        const bytes = config.bytes[work.operation]!;
        sendBytes(route.request, totalBytes(requireKnown(bytes.request, "bytes"), work.message?.bodyBytes?.request), "request", () => {
          delivered = true; state = "waiting"; const deliveredAt = kernel.now; latency.requestTransportUs += deliveredAt - readyAt;
          trace("request-delivered", key, route.target, work.rootId, work.attempt);
          if (!alive(route.target)) return;
          const request: Invocation = { ...work, sessionId: acquired.connection, ...(work.message ? { message: { request: JSON.parse(JSON.stringify(work.message.request)) } } : {}) };
          remote = deliver(route.target, request, (outcome) => {
            remoteFinished = true;
            if (terminal) {
              if (heldAfterStop) { if (hook?.returnTraffic && !hook.returnTraffic(acquired.connection)) lease?.fail("reset"); else lease?.release(); }
              remoteAfterStop++; trace("remote-after-transport-stop", key, outcome, work.rootId, work.attempt); return;
            }
            if (!alive(route.target)) return;
            if (hook?.returnTraffic && !hook.returnTraffic(acquired.connection)) { finish({ ok: false, reason: "reset", ambiguous: true }); return; }
            const serviceEnd = kernel.now; latency.remoteServiceUs += serviceEnd - deliveredAt;
            sendBytes(route.response, totalBytes(requireKnown(bytes.response, "bytes"), request.message?.bodyBytes?.response), "response", () => {
              if (work.message && request.message?.response !== undefined) work.message.response = JSON.parse(JSON.stringify(request.message.response));
              latency.responseTransportUs += kernel.now - serviceEnd;
              finish(outcome === "completed" ? { ok: true, ambiguous: false } : { ok: false, reason: "backend-rejected", ambiguous: true });
            });
          });
        });
      }, (reason: FailureReason) => finish({ ok: false, reason, ambiguous: delivered }));
      return { admitted: !terminal, state: () => state, cancel: () => {
        if (terminal) return "already-finished";
        finish({ ok: false, reason: "reset", ambiguous: delivered }, true); return "cancelled";
      } };
    },
    reset: () => pool.reset(), drain: (grace: number) => pool.drain(grace),
    measure: () => ({ id: config.id, source: config.source, target: config.target, offered, completed, failed, cancelled, live, remoteOutcomesAfterStop: remoteAfterStop, reasons: { ...reasons }, completedPhaseDurationsUs: { ...latency }, pool: pool.measure() }),
  };
}
