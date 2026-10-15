import { requireKnown } from "../reality/quantity";
import type { EventKernel } from "./time";
import type { ResourceBehavior, ServiceDemand, StationConfig, Work, WorkOutcome } from "./contracts";

interface Call { work: Work; done: (outcome: WorkOutcome) => void; phase: "cpu" | "io" | "dependency";
  remaining: number; cpuRemaining: number; since: number; generation: number }
export interface StationContext {
  kernel: EventKernel;
  send(target: string, work: Work, done: (outcome: WorkOutcome) => void): void;
  cancel(target: string, workId: string): void;
}

export function serviceStation(config: StationConfig, context: StationContext): ResourceBehavior {
  const { kernel } = context, concurrency = requireKnown(config.concurrency, "count"), capacity = requireKnown(config.queueCapacity, "count");
  const coreShare = requireKnown(config.cores, "cores") / concurrency;
  const active = new Map<string, Call>(), queue = new Map<string, Call>();
  let paused = false, completed = 0, rejected = 0, cpu = 0;
  const account = (call: Call) => {
    if (!paused && call.phase !== "dependency") {
      const elapsed = Math.min(kernel.now - call.since, call.remaining);
      if (call.phase === "cpu") { const used = Math.min(call.cpuRemaining, elapsed * coreShare); cpu += used; call.cpuRemaining -= used; }
      call.remaining -= elapsed; call.since = kernel.now;
    }
  };
  const startPhase = (call: Call) => {
    if (paused || call.phase === "dependency") return;
    call.since = kernel.now;
    const generation = ++call.generation;
    kernel.schedule(kernel.now + call.remaining, 2, `service/${JSON.stringify([config.id, call.work.id, generation])}`, () => {
      if (active.get(call.work.id) !== call || call.generation !== generation || paused) return;
      account(call);
      if (call.phase === "cpu") {
        call.phase = "io"; call.remaining = requireKnown(config.demand[call.work.classId]!.io, "us"); startPhase(call);
      } else if (config.downstream) {
        call.phase = "dependency";
        context.send(config.downstream, call.work, (outcome) => finish(call, outcome));
      } else finish(call, "completed");
    });
  };
  const pump = () => {
    while (!paused && queue.size && active.size < concurrency) {
      const call = queue.values().next().value!; queue.delete(call.work.id); active.set(call.work.id, call);
      const demand: ServiceDemand = config.demand[call.work.classId]!;
      // Each configured worker reserves an equal core share; unused shares are not redistributed.
      call.cpuRemaining = requireKnown(demand.cpu, "cpu-us");
      call.remaining = Math.ceil(call.cpuRemaining / coreShare); startPhase(call);
    }
  };
  const finish = (call: Call, outcome: WorkOutcome) => {
    if (!active.delete(call.work.id)) return;
    account(call); call.generation++;
    if (outcome === "completed") completed++; else rejected++;
    call.done(outcome); pump();
  };
  return {
    accept(work, done) {
      if (queue.size >= capacity && (paused || active.size >= concurrency)) { rejected++; done("rejected"); return; }
      queue.set(work.id, { work, done, phase: "cpu", remaining: 0, cpuRemaining: 0, since: kernel.now, generation: 0 }); pump();
    },
    cancel(id) {
      if (queue.delete(id)) rejected++;
      const call = active.get(id);
      if (call) {
        if (call.phase === "dependency" && config.downstream) context.cancel(config.downstream, id);
        account(call); active.delete(id); call.generation++; rejected++; pump();
      }
    },
    fault(value) {
      if (value === paused) throw new Error("Overlapping or unmatched service pause");
      if (value) for (const call of active.values()) { account(call); call.generation++; }
      paused = value;
      if (!paused) { for (const call of active.values()) startPhase(call); pump(); }
    },
    measure() {
      for (const call of active.values()) account(call);
      return { id: config.id, status: paused ? "unavailable" : queue.size ? "backpressured" : "healthy",
        queued: queue.size, active: active.size, waitingOnDependency: [...active.values()].filter((c) => c.phase === "dependency").length,
        completed, rejected, cpuConsumedUs: cpu, connections: config.kind === "database" ? active.size : null,
        memoryBytes: { kind: "unknown", unit: "bytes", provenance: ["m2.unmodeled-memory"], reason: "No working-set or allocation model in M2A" } };
    },
  };
}
