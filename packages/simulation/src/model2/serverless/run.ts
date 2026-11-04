import { requireKnown } from "../../reality/quantity";
import type { Deliver } from "../compute/run";
import { keyedUniform } from "../random";
import type { EventKernel } from "../time";
import type { Invocation, Receipt, RemoteCompletion, RemoteOutcome } from "../workload/contracts";
import type { ServerlessConfig } from "./contracts";

interface Instance { id: number; busy: boolean; expire?: () => boolean }
interface Active { instance: Instance; startedAt: number; phaseAt: number; phase: "initializing" | "executing" | "downstream"; cancelTimer?: () => boolean; cancelTimeout?: () => boolean; child?: Receipt; finish(outcome: RemoteOutcome, reason: string): void }
export function serverless(config: ServerlessConfig, clock: EventKernel, send: Deliver, seed: string) {
  const limit = requireKnown(config.concurrency, "count"), initialization = requireKnown(config.initialization, "us"), duration = requireKnown(config.duration, "us");
  const timeout = requireKnown(config.timeout, "us"), idle = requireKnown(config.idleExpiry, "us"), failure = requireKnown(config.failurePercent, "percent");
  const instances = new Map<number, Instance>(), live = new Map<string, Active>();
  let paused = false, sequence = 0, received = 0, admitted = 0, completed = 0, failed = 0, timedOut = 0, cancelled = 0, throttled = 0, unavailable = 0, duplicate = 0;
  let coldStarts = 0, warmStarts = 0, initialized = 0, expired = 0, scaleOut = 0, peakInstances = 0, downstreamCalls = 0, downstreamFailed = 0, busyUs = 0, omitted = 0;
  const phaseUs = { initializing: 0, executing: 0, downstream: 0 };
  let maxDurationUs = 0;
  const transition = (active: Active, phase: Active["phase"]) => {
    phaseUs[active.phase] += clock.now - active.phaseAt;
    active.phaseAt = clock.now; active.phase = phase;
  };
  const events: Array<{ atUs: number; invocation: string; instance: number | null; outcome: string }> = [];
  const record = (work: Invocation, instance: Instance | undefined, outcome: string) => { if (events.length < 2048) events.push({ atUs: clock.now, invocation: work.callId, instance: instance?.id ?? null, outcome }); else omitted++; };
  return {
    accept(work: Invocation, done: RemoteCompletion): Receipt {
      received++;
      const refusal = paused ? "unavailable" : live.has(work.callId) ? "duplicate" : live.size >= limit ? "throttled" : undefined;
      if (refusal) {
        if (refusal === "unavailable") unavailable++; else if (refusal === "duplicate") duplicate++; else throttled++;
        record(work, undefined, refusal); done("rejected"); return { admitted: false, state: () => "finished", cancel: () => "already-finished" };
      }
      let instance = [...instances.values()].find(i => !i.busy);
      const cold = !instance;
      if (!instance) { if (instances.size) scaleOut++; instance = { id: sequence++, busy: false }; instances.set(instance.id, instance); coldStarts++; peakInstances = Math.max(peakInstances, instances.size); }
      else { instance.expire?.(); instance.expire = undefined; warmStarts++; }
      const owner = instance; owner.busy = true; admitted++; record(work, owner, cold ? "cold-start" : "warm-start");
      let terminal = false;
      const active: Active = { instance: owner, startedAt: clock.now, phaseAt: clock.now, phase: cold ? "initializing" : "executing", finish(outcome, reason) {
        if (terminal) return; terminal = true; live.delete(work.callId); active.cancelTimer?.(); active.cancelTimeout?.(); busyUs += clock.now - active.startedAt;
        phaseUs[active.phase] += clock.now - active.phaseAt;
        maxDurationUs = Math.max(maxDurationUs, clock.now - active.startedAt);
        if (reason === "timeout") timedOut++; else if (outcome === "cancelled") cancelled++; else if (outcome === "completed") completed++; else failed++;
        record(work, owner, reason);
        if (outcome === "completed" && !paused) {
          owner.busy = false;
          owner.expire = clock.schedule(clock.now + idle, 0, JSON.stringify(["function-expire", config.id, owner.id, work.callId]), () => { instances.delete(owner.id); expired++; });
        } else instances.delete(owner.id);
        // Settle ownership before cancelling: a child may synchronously acknowledge cancellation.
        if (outcome !== "completed") active.child?.cancel();
        done(outcome);
      } };
      live.set(work.callId, active);
      active.cancelTimeout = clock.schedule(clock.now + timeout, 1, JSON.stringify(["function-timeout", config.id, work.callId]), () => active.finish("rejected", "timeout"));
      const execute = () => {
        transition(active, "executing");
        active.cancelTimer = clock.schedule(clock.now + duration, 2, JSON.stringify(["function-body", config.id, work.callId]), () => {
          if (keyedUniform(seed, config.id, work.callId, "invocation-failure") * 100 < failure) { active.finish("rejected", "invocation-failed"); return; }
          if (!config.database) { active.finish("completed", "completed"); return; }
          transition(active, "downstream"); downstreamCalls++;
          const child = { ...work, parentCallId: work.callId, callId: JSON.stringify(["function-database", config.id, work.callId]), message: undefined };
          active.child = send(config.database, child, outcome => {
            if (terminal) return;
            if (outcome !== "completed") downstreamFailed++;
            active.finish(outcome === "completed" ? "completed" : "rejected", outcome === "completed" ? "completed" : "downstream-failed");
          });
        });
      };
      if (cold) active.cancelTimer = clock.schedule(clock.now + initialization, 2, JSON.stringify(["function-init", config.id, work.callId]), () => { initialized++; execute(); });
      else execute();
      return { admitted: true, state: () => terminal ? "finished" : active.phase === "downstream" ? "waiting" : "serving", cancel: () => { if (terminal) return "already-finished"; active.finish("cancelled", "cancelled"); return "cancelled"; } };
    },
    pause(value: boolean) {
      paused = value;
      if (paused) { for (const active of [...live.values()]) active.finish("rejected", "unavailable"); for (const instance of instances.values()) instance.expire?.(); instances.clear(); }
    },
    measure: () => ({ id: config.id, paused, received, admitted, rejected: throttled + unavailable + duplicate, completed, failed: failed + timedOut, cancelled, queued: 0, serving: [...live.values()].filter(a => a.phase !== "downstream").length, waiting: [...live.values()].filter(a => a.phase === "downstream").length, consumedCoreUs: 0, busySlotUs: busyUs + [...live.values()].reduce((sum, a) => sum + clock.now - a.startedAt, 0) }),
    evidence: () => ({ id: config.id, received, admitted, completed, failed, timedOut, cancelled, throttled, unavailable, duplicate, coldStarts, warmStarts, initialized, expired, scaleOut, instances: instances.size, active: live.size, peakInstances, downstreamCalls, downstreamFailed, events: events.map(e => ({ ...e })), omitted, scope: "Educational elapsed invocation/init durations with one invocation per instance and bounded warm reuse. Shared downstream connection pool; per-instance pools, CPU/memory/provider timing and cost Unknown. Cancellation cannot prove rollback of downstream effects." }),
    // Include elapsed partial phases without turning in-flight work into latency samples.
    readings() {
      const phases = { ...phaseUs }, counts = { initializing: 0, executing: 0, downstream: 0 };
      for (const active of live.values()) { phases[active.phase] += clock.now - active.phaseAt; counts[active.phase]++; }
      return { ...this.evidence(), lifecycle: { ...counts, settled: completed + failed + timedOut + cancelled, totalDurationUs: busyUs, maxDurationUs, initializationUs: phases.initializing, executionUs: phases.executing, downstreamUs: phases.downstream, busyUs: phases.initializing + phases.executing + phases.downstream } };
    },
  };
}
