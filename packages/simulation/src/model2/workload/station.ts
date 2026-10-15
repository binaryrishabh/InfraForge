import { requireKnown } from "../../reality/quantity";
import type { EventKernel } from "../time";
import type { Invocation, Receipt, RemoteOutcome, StationState, WorkStation } from "./contracts";
import { identity } from "./arrivals";

interface Call {
  work: Invocation;
  done(outcome: RemoteOutcome): void;
  phase: "queued" | "cpu" | "io" | "waiting" | "finished";
  remaining: number;
  cpuRemaining: number;
  since: number;
  cancelEvent?: () => boolean;
  child?: Receipt;
}
export function workloadStation(config: WorkStation, demands: Map<string, { cpuUs: number; ioUs: number }>, kernel: EventKernel,
  send: (target: string, work: Invocation, done: Call["done"]) => Receipt) {
  const slots = requireKnown(config.concurrency, "count"), capacity = requireKnown(config.queueCapacity, "count");
  const share = requireKnown(config.cores, "cores") / slots;
  const active = new Map<string, Call>(), queue = new Map<string, Call>();
  let paused = false, received = 0, admitted = 0, rejected = 0, completed = 0, failed = 0, cancelled = 0, cpu = 0, busy = 0;
  const account = (call: Call) => {
    if (!paused && (call.phase === "cpu" || call.phase === "io")) {
      const elapsed = Math.min(kernel.now - call.since, call.remaining);
      if (call.phase === "cpu") {
        const consumed = Math.min(elapsed * share, call.cpuRemaining); cpu += consumed; call.cpuRemaining -= consumed;
      }
      busy += elapsed; call.remaining -= elapsed; call.since = kernel.now;
    }
  };
  const finish = (call: Call, outcome: RemoteOutcome) => {
    if (call.phase === "finished") return;
    account(call); active.delete(call.work.callId); queue.delete(call.work.callId); call.cancelEvent?.(); call.phase = "finished";
    if (outcome === "completed") completed++; else if (outcome === "cancelled") cancelled++; else failed++;
    call.done(outcome); pump();
  };
  const schedule = (call: Call) => {
    if (paused || (call.phase !== "cpu" && call.phase !== "io")) return;
    call.since = kernel.now;
    call.cancelEvent = kernel.schedule(kernel.now + call.remaining, 2, identity("service", config.id, call.work.callId), () => {
      account(call);
      if (call.phase === "cpu") { call.phase = "io"; call.remaining = demands.get(call.work.operation)!.ioUs; schedule(call); }
      else if (config.downstream) {
        call.phase = "waiting";
        // Append to a flat tuple. Re-encoding a nested JSON string at every stage
        // would double escaping and make identity size exponential in path depth.
        const child: Invocation = { ...call.work, parentCallId: call.work.callId, callId: identity(...JSON.parse(call.work.callId), "dependency", config.downstream) };
        call.child = send(config.downstream, child, (outcome) => finish(call, outcome));
      } else finish(call, "completed");
    });
  };
  const pump = () => {
    while (!paused && queue.size && active.size < slots) {
      const call = queue.values().next().value!; queue.delete(call.work.callId); active.set(call.work.callId, call);
      call.phase = "cpu"; call.cpuRemaining = demands.get(call.work.operation)!.cpuUs;
      call.remaining = Math.ceil(call.cpuRemaining / share); schedule(call);
    }
  };
  return {
    accept(work: Invocation, done: Call["done"]): Receipt {
      received++;
      if (queue.size >= capacity && (paused || active.size >= slots)) {
        rejected++; done("rejected");
        return { admitted: false, cancel: () => "already-finished", state: () => "finished" };
      }
      admitted++;
      const call: Call = { work, done, phase: "queued", remaining: 0, cpuRemaining: 0, since: kernel.now };
      queue.set(work.callId, call); pump();
      return { admitted: true, state: () => call.phase === "cpu" || call.phase === "io" ? "serving" : call.phase,
        cancel: () => {
          if (call.phase === "finished") return "already-finished";
          if (config.cancellation === "unsupported") return "unsupported";
          // Cancellation crosses only this explicit ownership edge. A child may refuse it.
          const child = call.child; finish(call, "cancelled"); child?.cancel(); return "cancelled";
        } };
    },
    pause(value: boolean) {
      if (value === paused) throw new Error("Overlapping/unmatched service pause");
      if (value) for (const call of active.values()) { account(call); call.cancelEvent?.(); }
      paused = value;
      if (!paused) { for (const call of active.values()) schedule(call); pump(); }
    },
    measure(): StationState {
      let projectedCpu = cpu, projectedBusy = busy;
      if (!paused) for (const call of active.values()) if (call.phase === "cpu" || call.phase === "io") {
        const elapsed = Math.min(kernel.now - call.since, call.remaining);
        projectedBusy += elapsed;
        if (call.phase === "cpu") projectedCpu += Math.min(call.cpuRemaining, elapsed * share);
      }
      const waiting = [...active.values()].filter((c) => c.phase === "waiting").length;
      return { id: config.id, paused, received, admitted, rejected, completed, failed, cancelled,
        queued: queue.size, serving: active.size - waiting, waiting, consumedCoreUs: projectedCpu, busySlotUs: projectedBusy };
    },
  };
}
