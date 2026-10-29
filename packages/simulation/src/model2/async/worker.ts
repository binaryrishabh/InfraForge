import { requireKnown } from "../../reality/quantity";
import { cpuScheduler } from "../compute/scheduler";
import type { Deliver } from "../compute/run";
import type { EventKernel } from "../time";
import type { Invocation, Receipt, RemoteOutcome } from "../workload/contracts";
import type { DataReply } from "../data/contracts";
import type { WorkerConfig, Delivery, QueueReply, ObjectReply } from "./contracts";
import { messageClient } from "./client";
import { ASYNC_LIMITS } from "./policy";
interface Processing { delivery: Delivery; work: Invocation; phase: "buffered" | "reading" | "cpu" | "blocking" | "effect" | "ack-wait" | "ack"; epoch: number; completedCpuUs?: number; cancel?: () => boolean }
export function asyncWorker(config: WorkerConfig, kernel: EventKernel, send: Deliver, horizon: number) {
  const local = new Map<string, Processing>(), active = new Set<string>(), cpu = cpuScheduler(config.id, requireKnown(config.execution.cores, "cores"), kernel);
  let available = true, epoch = 0, sequence = 0, pendingReceive = false, cancelledPoll: (() => boolean) | undefined, deliveries = 0, processed = 0, failed = 0, failedCpuUs = 0, lostOnCrash = 0, acked = 0, ackFailed = 0, deduplicated = 0, effects = 0, reads = 0, databaseWrites = 0, area = 0, anchor = kernel.now, rejectedInbound = 0;
  const events: Array<{ at: number; kind: string; message: string; receipt: string }> = []; let omitted = 0;
  const record = (kind: string, p: Processing) => { if (events.length < ASYNC_LIMITS.evidenceRows) events.push({ at: kernel.now, kind, message: p.delivery.id, receipt: p.delivery.receipt }); else omitted++; };
  const settle = () => { area += active.size * (kernel.now - anchor); anchor = kernel.now; };
  const valid = (p: Processing) => available && p.epoch === epoch && local.has(p.delivery.receipt);
  const finish = (p: Processing) => { if (!valid(p)) return; local.delete(p.delivery.receipt); settle(); active.delete(p.delivery.receipt); p.cancel?.(); pump(); };
  const process = (p: Processing) => {
    const request = messageClient(p.work, send), d = p.delivery;
    const negative = () => { if (!valid(p)) return; failed++; failedCpuUs += p.completedCpuUs ?? 0; record("processing-failed", p); request<QueueReply>(config.broker, { kind: "nack", consumer: config.id, receipt: d.receipt, action: "requeue" }, () => finish(p)); };
    const acknowledge = () => {
      if (!valid(p)) return; processed++; settle(); active.delete(d.receipt); p.phase = "ack-wait"; record("side-effect-completed", p); pump();
      p.cancel = kernel.schedule(kernel.now + requireKnown(config.ackDelay, "us"), 2, JSON.stringify(["consumer-ack", config.id, d.receipt]), () => {
        if (!valid(p)) return; p.phase = "ack"; request<QueueReply>(config.broker, { kind: "ack", consumer: config.id, receipt: d.receipt }, (reply, outcome) => { if (!valid(p)) return; if (outcome === "completed" && reply?.ok) acked++; else ackFailed++; finish(p); });
      });
    };
    const effect = () => {
      if (!valid(p)) return; p.phase = "effect";
      request<ObjectReply>(config.store, { kind: "put", namespace: config.namespace, key: d.logicalId, bytes: requireKnown(config.resultBytes, "bytes"), content: d.logicalId, ifAbsent: config.idempotency === "object-if-absent" }, (reply, outcome) => {
        if (!valid(p)) return;
        if (reply?.reason === "precondition-failed" && config.idempotency === "object-if-absent") {
          request<ObjectReply>(config.store, { kind: "head", namespace: config.namespace, key: d.logicalId }, (existing, result) => { if (!valid(p)) return; if (result !== "completed" || !existing?.ok || existing.object?.content !== d.logicalId || existing.object.bytes !== requireKnown(config.resultBytes, "bytes")) { negative(); return; } deduplicated++; acknowledge(); }); return;
        }
        if (outcome !== "completed" || !reply?.ok) { negative(); return; } effects++; record("object-effect", p);
        if (!config.database) { acknowledge(); return; }
        request<DataReply>(config.database, { kind: "query", key: config.databaseKey }, (db, result) => { if (!valid(p)) return; if (result !== "completed" || !db?.ok) { negative(); return; } databaseWrites++; acknowledge(); });
      }, requireKnown(config.resultBytes, "bytes"));
    };
    p.phase = "reading"; reads++;
    request<ObjectReply>(config.store, { kind: "get", namespace: d.body.namespace, key: d.body.objectKey }, (reply, outcome) => {
      if (!valid(p)) return; if (outcome !== "completed" || !reply?.ok) { negative(); return; }
      p.phase = "cpu"; cpu.add({ id: d.receipt, demand: requireKnown(config.cpu, "cpu-us"), cap: 1, done() {
        // Only a scheduler completion establishes spent CPU; failed reads spend none.
        // Crash-lost work is separate from attempts that reach negative().
        if (!valid(p)) return; p.completedCpuUs = requireKnown(config.cpu, "cpu-us"); p.phase = "blocking";
        p.cancel = kernel.schedule(kernel.now + requireKnown(config.blockingWait, "us"), 2, JSON.stringify(["consumer-work", config.id, d.receipt]), () => { if (config.poisonKeys.includes(d.body.key)) negative(); else effect(); });
      } });
    });
  };
  const pump = () => { if (!available) return; for (const p of local.values()) if (p.phase === "buffered" && active.size < requireKnown(config.concurrency, "count")) { settle(); active.add(p.delivery.receipt); process(p); } };
  const poll = () => {
    cancelledPoll = undefined; if (!available) return;
    if (!pendingReceive && local.size < requireKnown(config.prefetch, "count")) {
      pendingReceive = true; const current = epoch, id = JSON.stringify(["consumer-poll", config.id, sequence++]);
      const parent: Invocation = { rootId: id, callId: id, operation: config.databaseOperation, attempt: 0, offeredAt: kernel.now };
      messageClient(parent, send)<QueueReply>(config.broker, { kind: "receive", consumer: config.id }, (reply, outcome) => {
        if (!available || current !== epoch) return; pendingReceive = false;
        if (outcome === "completed" && reply?.delivery) { const d = reply.delivery, p: Processing = { delivery: d, work: { ...parent, rootId: d.logicalId, callId: JSON.stringify(["processing", config.id, d.id, d.attempt]), attempt: d.attempt }, epoch, phase: "buffered" }; local.set(d.receipt, p); deliveries++; record("received", p); pump(); }
      });
    }
    schedulePoll(requireKnown(config.pollInterval, "us"));
  };
  const schedulePoll = (delay: number) => { if (cancelledPoll || !available || kernel.now + delay > horizon) return; cancelledPoll = kernel.schedule(kernel.now + delay, 3, JSON.stringify(["consumer-poll-timer", config.id]), poll); };
  return {
    start() { schedulePoll(0); },
    accept(_work: Invocation, done: (outcome: RemoteOutcome) => void): Receipt { rejectedInbound++; done("rejected"); return { admitted: false, state: () => "finished", cancel: () => "already-finished" }; },
    pause(value: boolean) {
      if (available === !value) return;
      available = !value; epoch++; cancelledPoll?.(); cancelledPoll = undefined; pendingReceive = false;
      if (value) { settle(); for (const p of local.values()) { p.cancel?.(); if (p.phase === "cpu") cpu.remove(p.delivery.receipt); lostOnCrash++; record("consumer-lost", p); } local.clear(); active.clear(); }
      cpu.pause(value); if (!value) schedulePoll(0);
    },
    measure: () => ({ id: config.id, paused: !available, received: rejectedInbound, admitted: 0, rejected: rejectedInbound, completed: 0, failed: 0, cancelled: 0, queued: 0, serving: 0, waiting: 0, consumedCoreUs: cpu.measure().appCoreUs, busySlotUs: area + active.size * (kernel.now - anchor) }),
    inspectWorker: () => ({ processed, failed, failedCpuUs, active: active.size, creditOwnedLocally: local.size }),
    evidence: () => ({ id: config.id, available, deliveries, processed, failed, lostOnCrash, acknowledged: acked, ackFailed, deduplicated, effects, reads, databaseWrites, pendingReceive, active: active.size, creditOwnedLocally: local.size, buffered: [...local.values()].filter((p) => p.phase === "buffered").length, local: [...local.values()].map((p) => ({ receipt: p.delivery.receipt, message: p.delivery.id, attempt: p.delivery.attempt, phase: p.phase })), cpu: cpu.measure(), events: [...events], omitted }),
  };
}
