import { requireKnown } from "../../reality/quantity";
import type { Deliver } from "../compute/run";
import type { Invocation, Receipt } from "../workload/contracts";
import type { EventKernel } from "../time";
import type { FailureReason, PathConfig, Trace, TransportResult } from "./contracts";
import type { networkLink } from "./link";
import { connectionPool, type Lease } from "./pool";

export function pathTransport(config: PathConfig, kernel: EventKernel, links: Map<string, ReturnType<typeof networkLink>>, deliver: Deliver, alive: (id: string) => boolean, trace: Trace) {
  const pool = connectionPool(config.id, config.pool, kernel, () => alive(config.target) && [...config.request, ...config.response].every((id) => links.get(id)!.reachable()), trace);
  let offered = 0, completed = 0, failed = 0, cancelled = 0, remoteAfterStop = 0, live = 0;
  const reasons: Record<string, number> = {}, latency = { connectionWaitUs: 0, requestTransportUs: 0, remoteServiceUs: 0, responseTransportUs: 0 };
  return {
    exchange(work: Invocation, done: (result: TransportResult) => void): Receipt {
      offered++; live++; const start = kernel.now, key = work.callId;
      trace("path-offered", key, `${config.id}:${work.operation}:request=${requireKnown(config.bytes[work.operation]!.request, "bytes")}:response=${requireKnown(config.bytes[work.operation]!.response, "bytes")}`, work.rootId, work.attempt);
      let terminal = false, delivered = false, state: ReturnType<Receipt["state"]> = "queued", lease: Lease | undefined, remote: Receipt | undefined;
      let cancelAcquire: (() => boolean) | undefined, cancelTimeout: (() => boolean) | undefined, cancelTransfer: (() => boolean) | undefined;
      const finish = (result: TransportResult, isCancellation = false) => {
        if (terminal) return; terminal = true; state = "finished"; live--; cancelAcquire?.(); cancelTimeout?.(); cancelTransfer?.();
        if (result.ok) completed++; else if (isCancellation) cancelled++; else { failed++; reasons[result.reason!] = (reasons[result.reason!] ?? 0) + 1; }
        trace("transport-terminal", key, result.ok ? "completed" : isCancellation ? "cancelled" : result.reason!, work.rootId, work.attempt);
        if (!result.ok && !isCancellation && ["response-timeout", "reset", "drained"].includes(result.reason!)) lease?.fail(result.reason!); else lease?.release();
        if (!result.ok && delivered && config.pool.remoteCancellation === "request-cancellation") remote?.cancel();
        done(result);
      };
      const sendBytes = (ids: string[], bytes: number, direction: string, end: () => void) => {
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
          });
        }; next();
      };
      cancelAcquire = pool.acquire(key, (acquired) => {
        if (terminal) { acquired.release(); return; }
        lease = acquired; state = "serving"; const readyAt = kernel.now; latency.connectionWaitUs += readyAt - start;
        trace("connection-acquired", key, acquired.connection, work.rootId, work.attempt);
        cancelTimeout = kernel.schedule(kernel.now + requireKnown(config.pool.responseTimeout, "us"), 1, JSON.stringify(["upstream-timeout", config.id, key]), () => finish({ ok: false, reason: "response-timeout", ambiguous: delivered }));
        const bytes = config.bytes[work.operation]!;
        sendBytes(config.request, requireKnown(bytes.request, "bytes"), "request", () => {
          delivered = true; state = "waiting"; const deliveredAt = kernel.now; latency.requestTransportUs += deliveredAt - readyAt;
          trace("request-delivered", key, config.target, work.rootId, work.attempt);
          if (!alive(config.target)) return;
          remote = deliver(config.target, work, (outcome) => {
            if (terminal) { remoteAfterStop++; trace("remote-after-transport-stop", key, outcome, work.rootId, work.attempt); return; }
            if (!alive(config.target)) return;
            const serviceEnd = kernel.now; latency.remoteServiceUs += serviceEnd - deliveredAt;
            sendBytes(config.response, requireKnown(bytes.response, "bytes"), "response", () => {
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
