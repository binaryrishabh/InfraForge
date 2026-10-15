import { requireKnown } from "../../reality/quantity";
import type { EventKernel } from "../time";
import type { LinkConfig, Trace } from "./contracts";

interface Transfer { id: string; bytes: number; sent: number; queuedAt: number; state: "queued" | "serializing" | "propagating"; cancel?: () => boolean; done(result: "delivered" | "unreachable" | "overflow" | "aborted"): void }
export function networkLink(config: LinkConfig, kernel: EventKernel, trace?: Trace) {
  const live = new Map<string, Transfer>(), queue = new Map<string, Transfer>();
  let current: Transfer | undefined, anchor = kernel.now, rate = requireKnown(config.bandwidth, "bytes/s") / 1000000;
  let partition = false, extraDelay = 0, boundary: (() => boolean) | undefined;
  let offered = 0, accepted = 0, rejected = 0, transmitted = 0, delivered = 0, failed = 0, discarded = 0, busy = 0, queueWait = 0;
  const projected = () => current ? Math.min(current.bytes - current.sent, rate * (kernel.now - anchor)) : 0;
  const settle = () => { const n = projected(); if (current) { current.sent += n; transmitted += n; busy += rate > 0 ? n / rate : 0; } anchor = kernel.now; };
  const finish = (t: Transfer, result: "delivered" | "unreachable" | "overflow" | "aborted") => {
    if (!live.has(t.id)) return;
    t.cancel?.(); live.delete(t.id); queue.delete(t.id);
    if (current === t) { boundary?.(); current = undefined; }
    if (result === "delivered") delivered += t.bytes; else { failed += t.bytes; discarded += t.sent; }
    trace?.("link-terminal", t.id, `${config.id}:${result}:${t.bytes}bytes:offeredAt=${t.queuedAt}`);
    t.done(result);
  };
  const schedule = () => {
    boundary?.(); boundary = undefined;
    if (partition || !current || rate <= 0) return;
    const t = current;
    boundary = kernel.schedule(kernel.now + Math.ceil((t.bytes - t.sent) / rate), 2, JSON.stringify(["serialize", config.id]), () => {
      settle();
      // Floating division can round down by an ulp; never deliver unconsumed bytes.
      if (t.sent < t.bytes) { schedule(); return; }
      current = undefined; t.state = "propagating";
      trace?.("link-propagating", t.id, `${config.id}:${t.bytes}bytes`);
      t.cancel = kernel.schedule(kernel.now + requireKnown(config.propagation, "us") + extraDelay, 2, JSON.stringify(["propagate", config.id, t.id]), () => finish(t, "delivered"));
      pump();
    });
  };
  const pump = () => {
    if (partition || current || !queue.size) return;
    current = queue.values().next().value!; queue.delete(current.id); current.state = "serializing";
    trace?.("link-serialization", current.id, `${config.id}:${current.bytes}bytes`);
    queueWait += kernel.now - current.queuedAt; anchor = kernel.now; schedule();
  };
  return {
    transmit(id: string, bytes: number, done: Transfer["done"]) {
      if (live.has(id) || !Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid/duplicate byte transfer");
      offered += bytes;
      if (partition) { rejected += bytes; done("unreachable"); return () => false; }
      const queuedBytes = [...queue.values()].reduce((sum, t) => sum + t.bytes, 0);
      if (current && queuedBytes + bytes > requireKnown(config.bufferBytes, "bytes")) { rejected += bytes; done("overflow"); return () => false; }
      accepted += bytes; const t: Transfer = { id, bytes, sent: 0, queuedAt: kernel.now, state: "queued", done }; live.set(id, t); queue.set(id, t);
      trace?.("link-admitted", id, `${config.id}:${config.from}->${config.to}:${bytes}bytes`);
      pump();
      return () => { if (!live.has(id)) return false; settle(); finish(t, "aborted"); pump(); return true; };
    },
    partition(value: boolean) {
      settle(); partition = value;
      if (value) { boundary?.(); for (const t of [...live.values()]) finish(t, "unreachable"); }
      else pump();
    },
    bandwidth(bytesPerSecond: number) { settle(); rate = bytesPerSecond / 1000000; schedule(); },
    delay(us: number) { extraDelay = us; }, reachable: () => !partition,
    measure() {
      const n = projected(), pending = [...live.values()];
      return { id: config.id, from: config.from, to: config.to, partitioned: partition, bandwidthBytesPerSecond: rate * 1000000, addedPropagationUs: extraDelay,
        offeredBytes: offered, acceptedBytes: accepted, rejectedBytes: rejected, transmittedBytes: transmitted + n, deliveredBytes: delivered,
        failedBytes: failed, discardedTransmittedBytes: discarded, liveBytes: pending.reduce((sum, t) => sum + t.bytes, 0),
        liveTransmittedBytes: pending.reduce((sum, t) => sum + t.sent, 0) + n,
        queuedBytes: [...queue.values()].reduce((sum, t) => sum + t.bytes, 0), serializingRemainingBytes: current ? current.bytes - current.sent - n : 0,
        queuedTransfers: queue.size, serializing: current ? 1 : 0, propagating: pending.filter((t) => t.state === "propagating").length,
        busyUs: busy + (rate > 0 ? n / rate : 0), startedQueueWaitUs: queueWait };
    },
  };
}
