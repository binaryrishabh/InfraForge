import type { EventClock } from "../time";
import type { Invocation, Receipt, RemoteCompletion, RemoteOutcome } from "../workload/contracts";
import type { Cause } from "../workload/cause";
import { carryCause, causeFields } from "../workload/cause";
import type { CausalObserver } from "../workload/causal";
import { identity } from "../workload/arrivals";

export interface RuntimeFlowCall { id: string; kind: "call"; target: string; operation?: string }
export interface RuntimeFlowData { id: string; kind: "data"; target: string; operation: "read" | "write"; command: "query" | "cache-aside" }
export type RuntimeFlowStep = { id: string; kind: "compute" } | RuntimeFlowCall | RuntimeFlowData | {
  id: string; kind: "parallel"; branches: RuntimeFlowCall[]; wait: "all" | number;
};
export interface RuntimeFlow { steps: RuntimeFlowStep[] }

/** One request owns one cursor and at most eight preallocated branch slots. */
export function applicationFlow(owner: string, work: Invocation, flow: RuntimeFlow, clock: EventClock,
  send: (target: string, work: Invocation, done: RemoteCompletion) => Receipt,
  compute: (step: string, done: () => void) => void, finish: RemoteCompletion, causal?: CausalObserver) {
  type Slot = { branch: RuntimeFlowCall | RuntimeFlowData; work: Invocation; receipt?: Receipt; outcome?: RemoteOutcome; cause?: Cause };
  let cursor = 0, terminal = false, paused = false, parked: (() => void) | undefined, cancelContinuation: (() => boolean) | undefined;
  let slots: Slot[] = [], step: RuntimeFlowStep | undefined, stepSettled = false;
  const emit = (kind: string, detail: Record<string, string | number | boolean | null>, child = work) => causal?.({ atUs: clock.now, resource: owner, work: child, kind: `flow-${kind}`, detail });
  const dataFields = (branch: RuntimeFlowCall | RuntimeFlowData): Record<string, string> => branch.kind === "data" ? { target: branch.target, operation: branch.operation, command: branch.command } : {};
  const settleStep = (outcome: RemoteOutcome) => {
    if (!step || stepSettled) return;
    stepSettled = true; emit("step-terminal", { step: step.id, outcome });
  };
  const cancelSlots = (reason: string) => {
    for (const slot of slots) if (!slot.outcome && slot.receipt) {
      slot.outcome = "cancelled";
      emit("branch-terminal", { step: step!.id, branch: slot.branch.id, outcome: reason, ...dataFields(slot.branch) }, slot.work);
      slot.receipt.cancel();
    }
  };
  const stop = (outcome: RemoteOutcome, cause?: Cause) => {
    if (terminal) return;
    terminal = true; parked = undefined; cancelContinuation?.();
    settleStep(outcome);
    cancelSlots(outcome === "completed" ? "cancelled-after-join" : "cancelled-after-stop");
    finish(outcome, cause);
  };
  const schedule = (phase: string, run: () => void) => {
    cancelContinuation = clock.schedule(clock.now, 2, identity("flow-continuation", work.callId, step?.id ?? "entry", phase), () => {
      cancelContinuation = undefined;
      if (terminal) return;
      if (paused) parked = run; else run();
    });
  };
  const next = () => {
    if (terminal) return;
    step = flow.steps[cursor++];
    if (!step) { stop("completed"); return; }
    stepSettled = false;
    emit("step-start", { step: step.id, kind: step.kind });
    if (step.kind === "compute") {
      compute(step.id, () => { if (!terminal) { settleStep("completed"); schedule("computed", next); } });
      return;
    }
    const current = step, branches = current.kind !== "parallel" ? [current] : current.branches;
    const threshold = current.kind !== "parallel" || current.wait === "all" ? branches.length : current.wait;
    slots = branches.map(branch => ({ branch, work: {
      rootId: work.rootId, attempt: work.attempt, offeredAt: work.offeredAt, parentCallId: work.callId,
      callId: identity(...JSON.parse(work.callId), "flow", owner, work.operation, current.id, branch.id), operation: branch.operation ?? work.operation,
      ...(branch.kind === "data" ? { message: { request: { kind: "query", key: "key" } } } : {}),
    } }));
    let dispatching = true, joined = false;
    const evaluate = () => {
      if (terminal || joined || dispatching) return;
      const succeeded = slots.filter(s => s.outcome === "completed"), unsettled = slots.filter(s => !s.outcome).length;
      if (succeeded.length >= threshold) {
        joined = true;
        emit("join", { step: current.id, threshold, contributors: JSON.stringify(succeeded.map(s => s.branch.id)), failed: slots.filter(s => s.outcome === "rejected").length });
        // Freeze this join before cancellation can synchronously invoke a callback.
        cancelSlots("cancelled-after-join");
        settleStep("completed");
        schedule("joined", next);
      } else if (succeeded.length + unsettled < threshold) {
        const cause = slots.find(s => s.cause)?.cause;
        stop("rejected", cause ? carryCause(cause) : undefined);
      }
    };
    for (const slot of slots) {
      emit("branch-start", { step: current.id, branch: slot.branch.id, target: slot.branch.target, ...dataFields(slot.branch) }, slot.work);
      slot.receipt = send(slot.branch.target, slot.work, (outcome, cause) => {
        // Our receipt cancellation can acknowledge synchronously as a rejection.
        // Actual remote-after-stop outcomes are observed by transport, never this callback.
        if (terminal || joined || slot.outcome) return;
        slot.outcome = outcome; slot.cause = cause;
        emit("branch-terminal", { step: current.id, branch: slot.branch.id, outcome, ...(slot.branch.kind === "data" ? { ...dataFields(slot.branch), ...causeFields(cause), ...(slot.work.message?.response && typeof slot.work.message.response === "object" && "hit" in slot.work.message.response ? { hit: !!slot.work.message.response.hit } : {}) } : {}) }, slot.work);
        evaluate();
      });
    }
    dispatching = false; evaluate();
  };
  return {
    start() { schedule("start", next); },
    cancel() { if (terminal) return; terminal = true; cancelContinuation?.(); parked = undefined; settleStep("cancelled"); cancelSlots("cancelled-after-stop"); },
    pause(value: boolean) { paused = value; if (!value && parked) { const run = parked; parked = undefined; schedule("resumed", run); } },
  };
}
