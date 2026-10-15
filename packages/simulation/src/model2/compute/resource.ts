import { requireKnown } from "../../reality/quantity";
import type { EventKernel } from "../time";
import type { Invocation, Receipt, RemoteOutcome } from "../workload/contracts";
import type { ComputeResource, ComputeProfile, ComputeState } from "./contracts";
import { identity } from "../workload/arrivals";
import { cpuScheduler } from "./scheduler";
import { residentMemory } from "./memory";

interface Call { work: Invocation; phase: "queued" | "cpu" | "wait" | "dependency" | "finished";
  done(outcome: RemoteOutcome): void; child?: Receipt; cancelWait?: () => boolean; waitRemaining: number; waitSince: number }
export function computeResource(config: ComputeResource, profiles: Map<string, ComputeProfile>, kernel: EventKernel,
  send: (target: string, work: Invocation, done: Call["done"]) => Receipt) {
  const workers = requireKnown(config.workers, "count"), capacity = requireKnown(config.queueCapacity, "count");
  const scheduler = cpuScheduler(config.id, requireKnown(config.cores, "cores"), kernel, config.quota ? { budget: requireKnown(config.quota.budget, "cpu-us"), period: requireKnown(config.quota.period, "us") } : undefined);
  const memory = residentMemory(config, profiles), active = new Map<string, Call>(), queue = new Map<string, Call>();
  let paused = false, received = 0, admitted = 0, rejected = 0, completed = 0, failed = 0, cancelled = 0, allocationRejected = 0, pumping = false;
  let occupancyAt = kernel.now, occupancy = 0;
  const accountOccupancy = () => { occupancy += active.size * (kernel.now - occupancyAt); occupancyAt = kernel.now; };
  const finish = (call: Call, outcome: RemoteOutcome) => {
    if (call.phase === "finished") return;
    if (call.phase === "cpu") scheduler.remove(call.work.callId);
    accountOccupancy(); call.cancelWait?.(); active.delete(call.work.callId); queue.delete(call.work.callId); memory.release(call.work.callId); call.phase = "finished";
    if (outcome === "completed") completed++; else if (outcome === "cancelled") cancelled++; else failed++;
    call.done(outcome); pump();
  };
  const scheduleWait = (call: Call) => {
    if (paused) return;
    call.waitSince = kernel.now;
    call.cancelWait = kernel.schedule(kernel.now + call.waitRemaining, 2, identity("blocking-wait", config.id, call.work.callId), () => {
      call.waitRemaining = 0;
      if (config.downstream) {
        call.phase = "dependency";
        const child = { ...call.work, parentCallId: call.work.callId, callId: identity(...JSON.parse(call.work.callId), "dependency", config.downstream) };
        call.child = send(config.downstream, child, (outcome) => finish(call, outcome));
      } else finish(call, "completed");
    });
  };
  const pump = () => {
    if (pumping) return;
    pumping = true;
    while (!paused && active.size < workers && queue.size) {
      const call = queue.values().next().value!; queue.delete(call.work.callId);
      if (!memory.activate(call.work.callId)) { allocationRejected++; finish(call, "rejected"); continue; }
      accountOccupancy(); active.set(call.work.callId, call); call.phase = "cpu";
      const p = profiles.get(call.work.operation)!;
      scheduler.add({ id: call.work.callId, demand: requireKnown(p.cpu, "cpu-us"), cap: requireKnown(p.maxCpuParallelism, "cores"), done: () => {
        if (call.phase === "finished") return;
        call.phase = "wait"; call.waitRemaining = requireKnown(p.blockingWait, "us"); scheduleWait(call);
      } });
    }
    pumping = false;
  };
  return {
    accept(work: Invocation, done: Call["done"]): Receipt {
      received++;
      const full = queue.size >= capacity && (paused || active.size >= workers);
      const memoryAccepted = !full && memory.acquire(work.callId, work.operation, false);
      if (full || !memoryAccepted) {
        if (!full) allocationRejected++;
        rejected++; done("rejected"); return { admitted: false, cancel: () => "already-finished", state: () => "finished" };
      }
      admitted++;
      const call: Call = { work, done, phase: "queued", waitRemaining: 0, waitSince: kernel.now };
      queue.set(work.callId, call); pump();
      return { admitted: true, state: () => call.phase === "cpu" || call.phase === "wait" ? "serving" : call.phase === "dependency" ? "waiting" : call.phase,
        cancel: () => { if (call.phase === "finished") return "already-finished"; if (config.cancellation === "unsupported") return "unsupported";
          const child = call.child; finish(call, "cancelled"); child?.cancel(); return "cancelled"; } };
    },
    pause(value: boolean) {
      if (value === paused) throw new Error("Overlapping/unmatched compute pause");
      if (value) for (const call of active.values()) if (call.phase === "wait") { call.waitRemaining -= kernel.now - call.waitSince; call.cancelWait?.(); }
      paused = value; scheduler.pause(value);
      if (!paused) { for (const call of active.values()) if (call.phase === "wait") scheduleWait(call); pump(); }
    },
    setCapacity(cores: number) { scheduler.capacity(cores); },
    abortOwned() { for (const call of [...active.values(), ...queue.values()]) { const child = call.child; finish(call, "rejected"); child?.cancel(); } },
    competitor(id: string, demand: number, parallelism: number) { scheduler.add({ id, demand, cap: parallelism, competitor: true, done: () => {} }); },
    removeCompetitor(id: string) { scheduler.remove(id); },
    measure(): ComputeState {
      const cpu = scheduler.measure(), resident = memory.measure();
      const blockedWait = [...active.values()].filter((c) => c.phase === "wait").length, blockedDependency = [...active.values()].filter((c) => c.phase === "dependency").length;
      const runnable = active.size - blockedWait - blockedDependency;
      return { id: config.id, paused, received, admitted, rejected, completed, failed, cancelled, queued: queue.size, serving: runnable + blockedWait, waiting: blockedDependency,
        consumedCoreUs: cpu.appCoreUs, busySlotUs: occupancy + active.size * (kernel.now - occupancyAt), compute: { workers: { configured: workers, idle: workers - active.size, runnable, blockedWait, blockedDependency }, cpu, memory: resident, allocationRejected,
          symptoms: [ ...(paused || cpu.capacity === 0 ? ["unavailable"] : []), ...(queue.size ? ["backpressured"] : []), ...(cpu.throttled ? ["cpu-throttled"] : []), ...(cpu.contended && !cpu.throttled ? ["cpu-contended"] : []), ...(resident.comparison === "exceeds" ? ["modeled-resident-limit-exceeded"] : []) ] } };
    },
  };
}
