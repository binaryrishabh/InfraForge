import { requireKnown } from "../../reality/quantity";
import { cpuScheduler } from "../compute/scheduler";
import type { CommandConfig } from "../async/contracts";
import type { Invocation, Receipt, RemoteOutcome } from "../workload/contracts";
import type { EventKernel } from "../time";
interface Job { work: Invocation; done(outcome: RemoteOutcome): void; terminal: boolean; timer?: () => boolean; wait?: () => boolean; child?: () => void; cpu: boolean }
export interface Reply { ok: boolean; reason?: string }

// Resource-specific handlers retain their own state; this helper owns command work.
export function systemService(id: string, config: CommandConfig, kernel: EventKernel, apply: (work: Invocation, done: (reply: Reply) => void) => (() => void) | void) {
  const cpu = cpuScheduler(id, requireKnown(config.execution.cores, "cores"), kernel), pending = new Map<string, Job>(), active = new Map<string, Job>();
  let paused = false, pumping = false, received = 0, admitted = 0, rejected = 0, completed = 0, failed = 0, cancelled = 0, area = 0, anchor = kernel.now;
  const settle = () => { area += active.size * (kernel.now - anchor); anchor = kernel.now; };
  const finish = (j: Job, reply: Reply, cancel = false) => {
    if (j.terminal) return; j.terminal = true; j.timer?.(); j.wait?.(); if (j.cpu) cpu.remove(j.work.callId); j.child?.(); settle(); active.delete(j.work.callId); pending.delete(j.work.callId);
    if (cancel) cancelled++; else if (reply.ok) completed++; else failed++;
    if (j.work.message) j.work.message.response = reply; j.done(cancel ? "cancelled" : reply.ok ? "completed" : "rejected"); pump();
  };
  const pump = () => {
    if (paused || pumping) return; pumping = true;
    while (pending.size && active.size < requireKnown(config.concurrency, "count")) {
      const j = pending.values().next().value!; pending.delete(j.work.callId); settle(); active.set(j.work.callId, j);
      const kind = (j.work.message?.request as { kind?: string } | undefined)?.kind, demand = kind && config.demands[kind];
      if (!demand) { finish(j, { ok: false, reason: "unsupported-command" }); continue; }
      j.cpu = true; cpu.add({ id: j.work.callId, demand: requireKnown(demand.cpu, "cpu-us"), cap: 1, done() {
        j.cpu = false; j.wait = kernel.schedule(kernel.now + requireKnown(demand.wait, "us"), 2, JSON.stringify(["system-command", id, j.work.callId]), () => {
          const stop = apply(j.work, (reply) => finish(j, reply)); if (j.terminal) stop?.(); else j.child = stop ?? undefined;
        });
      } });
    }
    pumping = false;
  };
  return {
    accept(work: Invocation, done: Job["done"]): Receipt {
      received++;
      if (paused || (active.size >= requireKnown(config.concurrency, "count") && pending.size >= requireKnown(config.pending, "count"))) { rejected++; if (work.message) work.message.response = { ok: false, reason: paused ? "service-unavailable" : "command-queue-full" }; done("rejected"); return { admitted: false, state: () => "finished", cancel: () => "already-finished" }; }
      admitted++; const j: Job = { work, done, terminal: false, cpu: false }; pending.set(work.callId, j);
      j.timer = kernel.schedule(kernel.now + requireKnown(config.timeout, "us"), 1, JSON.stringify(["system-timeout", id, work.callId]), () => finish(j, { ok: false, reason: "command-timeout" })); pump();
      return { admitted: true, state: () => j.terminal ? "finished" : pending.has(work.callId) ? "queued" : "serving", cancel() { if (j.terminal) return "already-finished"; finish(j, { ok: false, reason: "cancelled" }, true); return "cancelled"; } };
    },
    pause(value: boolean) { if (value === paused) return; paused = value; cpu.pause(value); if (value) for (const j of [...active.values(), ...pending.values()]) finish(j, { ok: false, reason: "service-unavailable" }); else pump(); },
    measure: () => ({ id, paused, received, admitted, rejected, completed, failed, cancelled, queued: pending.size, serving: active.size, waiting: 0, consumedCoreUs: cpu.measure().appCoreUs, busySlotUs: area + active.size * (kernel.now - anchor) }),
    serviceEvidence: () => ({ cpu: cpu.measure(), active: active.size, pending: pending.size }),
  };
}
