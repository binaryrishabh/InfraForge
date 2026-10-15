import { requireKnown } from "../../reality/quantity";
import { cpuScheduler } from "../compute/scheduler";
import type { EventKernel } from "../time";
import type { Invocation, Receipt, RemoteOutcome } from "../workload/contracts";
import type { CommandConfig } from "./contracts";
interface Command { work: Invocation; done(outcome: RemoteOutcome): void; terminal: boolean; cpu: boolean; cancelTimeout?: () => boolean; cancelWait?: () => boolean }
export function commandService(id: string, config: CommandConfig, kernel: EventKernel, apply: (work: Invocation) => { ok: boolean; reason?: string }) {
  const cpu = cpuScheduler(id, requireKnown(config.execution.cores, "cores"), kernel), queue = new Map<string, Command>(), active = new Map<string, Command>();
  let paused = false, pumping = false, received = 0, admitted = 0, rejected = 0, completed = 0, failed = 0, cancelled = 0, area = 0, anchor = kernel.now;
  const reasons: Record<string, number> = {};
  const settle = () => { area += active.size * (kernel.now - anchor); anchor = kernel.now; };
  const finish = (c: Command, reply: { ok: boolean; reason?: string }, cancel = false) => {
    if (c.terminal) return; c.terminal = true; c.cancelTimeout?.(); c.cancelWait?.(); if (c.cpu) cpu.remove(c.work.callId); settle(); active.delete(c.work.callId); queue.delete(c.work.callId);
    if (cancel) cancelled++; else if (reply.ok) completed++; else failed++; if (reply.reason) reasons[reply.reason] = (reasons[reply.reason] ?? 0) + 1;
    if (c.work.message) c.work.message.response = reply; c.done(cancel ? "cancelled" : reply.ok ? "completed" : "rejected"); pump();
  };
  const pump = () => {
    if (paused || pumping) return; pumping = true;
    while (queue.size && active.size < requireKnown(config.concurrency, "count")) {
      const c = queue.values().next().value!; queue.delete(c.work.callId); settle(); active.set(c.work.callId, c); const kind = (c.work.message?.request as { kind?: string } | undefined)?.kind, demand = kind && config.demands[kind];
      if (!demand) { finish(c, { ok: false, reason: "unsupported-command" }); continue; }
      c.cpu = true; cpu.add({ id: c.work.callId, demand: requireKnown(demand.cpu, "cpu-us"), cap: 1, done() { c.cpu = false; c.cancelWait = kernel.schedule(kernel.now + requireKnown(demand.wait, "us"), 2, JSON.stringify(["async-command", id, c.work.callId]), () => finish(c, apply(c.work))); } });
    }
    pumping = false;
  };
  return {
    accept(work: Invocation, done: Command["done"]): Receipt {
      received++; if (paused || (active.size >= requireKnown(config.concurrency, "count") && queue.size >= requireKnown(config.pending, "count"))) { rejected++; if (work.message) work.message.response = { ok: false, reason: paused ? "service-unavailable" : "command-queue-full" }; done("rejected"); return { admitted: false, state: () => "finished", cancel: () => "already-finished" }; }
      admitted++; const c: Command = { work, done, terminal: false, cpu: false }; queue.set(work.callId, c); c.cancelTimeout = kernel.schedule(kernel.now + requireKnown(config.timeout, "us"), 1, JSON.stringify(["async-command-timeout", id, work.callId]), () => finish(c, { ok: false, reason: "command-timeout" })); pump();
      return { admitted: true, state: () => c.terminal ? "finished" : queue.has(work.callId) ? "queued" : "serving", cancel() { if (c.terminal) return "already-finished"; finish(c, { ok: false, reason: "cancelled" }, true); return "cancelled"; } };
    },
    pause(value: boolean) { paused = value; cpu.pause(value); if (value) for (const c of [...active.values(), ...queue.values()]) finish(c, { ok: false, reason: "service-unavailable" }); else pump(); },
    measure: () => ({ id, paused, received, admitted, rejected, completed, failed, cancelled, queued: queue.size, serving: active.size, waiting: 0, consumedCoreUs: cpu.measure().appCoreUs, busySlotUs: area + active.size * (kernel.now - anchor) }),
    evidence: () => ({ cpu: cpu.measure(), reasons: { ...reasons }, active: [...active.values()].map((c) => ({ id: c.work.callId, kind: (c.work.message?.request as { kind: string }).kind, cpu: c.cpu })), pending: queue.size }),
  };
}
