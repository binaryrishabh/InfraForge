import { requireKnown } from "../../reality/quantity";
import type { EventKernel } from "../time";
import type { Invocation } from "../workload/contracts";
import type { CircuitBreakerPolicy, Trace, TransportResult } from "./contracts";

type State = "closed" | "open" | "half-open";
interface Admission { generation: number; epoch: number; probe: boolean; health: boolean; work: Invocation; completed: boolean }
const counted = new Set(["connect-timeout", "response-timeout", "reset", "backend-rejected"]);

/** One path owns one machine. Tokens prevent stale in-flight completions from changing a newer epoch. */
export function circuitBreaker(path: string, policy: CircuitBreakerPolicy, kernel: EventKernel, trace: Trace) {
  let state: State = "closed", generation = 0, epoch = 0, consecutiveFailures = 0, openUntil: number | null = null;
  let cooldownTimer: (() => boolean) | undefined, probe: Admission | undefined, disposed = false;
  const transitions: Record<string, number> = {}, rejected = { open: 0, "half-open": 0, disposed: 0 };
  const probes = { started: 0, succeeded: 0, failed: 0, cancelled: 0, ignored: 0 };
  const emit = (kind: string, detail: Record<string, unknown>, work?: Invocation) => trace(kind, path, JSON.stringify({ path, generation, epoch, ...detail }), work?.rootId, work?.attempt, true);
  const transition = (next: State, reason: string, work?: Invocation) => {
    const from = state; state = next; epoch++;
    const edge = `${from}->${next}`; transitions[edge] = (transitions[edge] ?? 0) + 1;
    emit("breaker-transition", { from, to: next, reason, triggeringFailure: counted.has(reason) ? reason : null, openUntil }, work);
  };
  const open = (reason: string, work: Invocation) => {
    cooldownTimer?.(); openUntil = kernel.now + requireKnown(policy.cooldown, "us");
    transition("open", reason, work);
    const activeEpoch = epoch, activeGeneration = generation;
    cooldownTimer = kernel.schedule(openUntil, 2, JSON.stringify(["breaker", path, generation, epoch]), () => {
      cooldownTimer = undefined;
      if (disposed || activeEpoch !== epoch || activeGeneration !== generation) return;
      openUntil = null; transition("half-open", "cooldown-elapsed");
    });
  };
  const complete = (token: Admission, result: TransportResult, cancelled = false, localReset = false) => {
    if (token.completed) return; token.completed = true;
    if (disposed || token.generation !== generation || token.epoch !== epoch) return;
    const failure = !result.ok && !cancelled && !localReset && counted.has(result.reason!);
    if (token.probe) {
      probe = undefined;
      const outcome = cancelled ? "cancelled" : result.ok ? "succeeded" : failure ? "failed" : "ignored";
      probes[outcome]++; emit("breaker-probe-result", { outcome, reason: result.reason ?? "completed", callId: token.work.callId }, token.work);
      if (result.ok) { consecutiveFailures = 0; openUntil = null; transition("closed", "probe-succeeded", token.work); }
      else if (failure) { consecutiveFailures++; open(result.reason!, token.work); }
      return;
    }
    // CLOSED health checks affect LB health only. A health call can close only through the reserved HALF-OPEN token above.
    if (token.health) return;
    if (result.ok) consecutiveFailures = 0;
    else if (failure && ++consecutiveFailures >= requireKnown(policy.failureThreshold, "count")) open(result.reason!, token.work);
  };
  return {
    admit(work: Invocation, health = false): Admission | undefined {
      if (disposed || state === "open" || (state === "half-open" && probe)) {
        const reason = disposed ? "disposed" : state as "open" | "half-open";
        rejected[reason]++; emit("breaker-rejected", { state: reason, callId: work.callId }, work); return;
      }
      const token: Admission = { generation, epoch, probe: state === "half-open", health, work, completed: false };
      if (token.probe) { probe = token; probes.started++; emit("breaker-probe-start", { callId: work.callId, health }, work); }
      return token;
    },
    complete,
    dispose() {
      if (disposed) return;
      if (probe) complete(probe, { ok: false, reason: "reset", ambiguous: false }, true);
      disposed = true; cooldownTimer?.(); cooldownTimer = undefined; openUntil = null; probe = undefined; epoch++;
    },
    startGeneration() {
      cooldownTimer?.(); cooldownTimer = undefined; openUntil = null; probe = undefined;
      generation++; disposed = false; consecutiveFailures = 0; transition("closed", "new-generation");
    },
    measure: () => ({ profile: policy.profile, state, generation, epoch, consecutiveFailures, openUntil, probeInFlight: !!probe, disposed,
      transitions: { ...transitions }, rejected: { ...rejected }, probes: { ...probes } }),
  };
}
