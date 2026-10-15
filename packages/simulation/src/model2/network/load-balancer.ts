import { requireKnown } from "../../reality/quantity";
import type { EventKernel } from "../time";
import { lexical } from "../time";
import { keyedUniform } from "../random";
import type { Invocation, OperationClass, Receipt, RemoteOutcome } from "../workload/contracts";
import type { LoadBalancer, Trace, TransportResult } from "./contracts";
import type { pathTransport } from "./transport";

interface Request { work: Invocation; done(outcome: RemoteOutcome): void; receipt?: Receipt; timer?: () => boolean; retryTimer?: () => boolean; attempt: number; backend?: string; retrying: boolean; terminal: boolean }
export function loadBalancer(config: LoadBalancer, kernel: EventKernel, paths: Map<string, ReturnType<typeof pathTransport>>, operations: Map<string, OperationClass>, seed: string, horizon: number, trace: Trace) {
  const members = [...config.backends].sort().map((id) => ({ id, health: config.health.initial === "eligible", draining: false, successes: 0, failures: 0, outstanding: 0, selected: 0, probes: 0, cancelCheck: undefined as (() => boolean) | undefined }));
  const active = new Map<string, Request>(), pending = new Map<string, Request>();
  let received = 0, completed = 0, rejected = 0, cancelled = 0, attempts = 0, retries = 0, retryLimited = 0, activeRetries = 0, cursor = 0, pumping = false;
  const path = (backend: string) => paths.get(JSON.stringify([config.id, backend]))!;
  const finish = (r: Request, outcome: RemoteOutcome) => {
    if (r.terminal) return; r.terminal = true; r.timer?.(); r.retryTimer?.(); active.delete(r.work.callId); pending.delete(r.work.callId);
    if (outcome === "completed") completed++; else if (outcome === "cancelled") cancelled++; else rejected++;
    r.done(outcome); pump();
  };
  const choose = () => {
    const eligible = members.filter((m) => m.health && !m.draining);
    if (!eligible.length) return;
    if (config.policy === "least-outstanding") return eligible.sort((a, b) => a.outstanding - b.outstanding || lexical(a.id, b.id))[0];
    for (let i = 0; i < members.length; i++) { const m = members[cursor++ % members.length]!; if (m.health && !m.draining) return m; }
  };
  const attempt = (r: Request) => {
    if (r.terminal) return;
    const member = choose(); if (!member) { trace("lb-failure", r.work.callId, "no-backend", r.work.rootId, r.work.attempt); finish(r, "rejected"); return; }
    if (r.attempt && config.retry && activeRetries >= requireKnown(config.retry.maxConcurrentRetries, "count")) { retryLimited++; finish(r, "rejected"); return; }
    r.attempt++; attempts++; member.outstanding++; member.selected++; r.backend = member.id;
    if (r.attempt > 1) { retries++; activeRetries++; r.retrying = true; }
    const work: Invocation = { ...r.work, attempt: r.work.attempt + r.attempt - 1, parentCallId: r.work.callId,
      callId: JSON.stringify([...JSON.parse(r.work.callId), "lb", config.id, "try", r.attempt, member.id]) };
    trace("lb-selected", work.callId, member.id, work.rootId, work.attempt);
    r.receipt = path(member.id).exchange(work, (result: TransportResult) => {
      member.outstanding--; if (r.retrying) { activeRetries--; r.retrying = false; }
      if (r.terminal) return;
      trace("attempt-terminal", work.callId, result.ok ? "completed" : result.reason!, work.rootId, work.attempt);
      if (result.ok) { finish(r, "completed"); return; }
      const policy = config.retry, op = operations.get(r.work.operation)!;
      const safe = !result.ambiguous || ["read-only", "idempotent"].includes(op.idempotency) || policy?.allowAmbiguousNonIdempotent;
      if (!policy || r.attempt >= requireKnown(policy.maxAttempts, "count") || !policy.retryOn.includes(result.reason!) || !safe) { finish(r, "rejected"); return; }
      const jitter = 1 + requireKnown(policy.jitter, "ratio") * (2 * keyedUniform(seed, config.id, work.callId, "retry-backoff") - 1);
      const delay = Math.ceil(requireKnown(policy.backoff, "us") * 2 ** (r.attempt - 1) * jitter);
      trace("retry-scheduled", work.callId, `${result.reason}:${delay}us`, work.rootId, work.attempt);
      r.retryTimer = kernel.schedule(kernel.now + delay, 3, JSON.stringify(["retry", config.id, r.work.callId, r.attempt]), () => attempt(r));
    });
  };
  const pump = () => {
    if (pumping) return; pumping = true;
    while (pending.size && active.size < requireKnown(config.maxOutstanding, "count")) {
      const r = pending.values().next().value!; pending.delete(r.work.callId); r.timer?.(); active.set(r.work.callId, r); attempt(r);
    }
    pumping = false;
  };
  for (const member of members) {
    let probe = 0;
    const check = () => {
      if (member.draining) return;
      const number = probe++, key = JSON.stringify(["health", config.id, member.id, number]); member.probes++;
      let terminal = false, receipt: Receipt | undefined;
      const observe = (ok: boolean, reason: string) => {
        if (terminal) return; terminal = true; timeout();
        if (ok) { member.successes++; member.failures = 0; if (member.successes >= requireKnown(config.health.healthy, "count")) member.health = true; }
        else { member.failures++; member.successes = 0; if (member.failures >= requireKnown(config.health.unhealthy, "count")) member.health = false; }
        trace("health-observation", key, `${reason}:eligible=${member.health}`);
      };
      const timeout = kernel.schedule(kernel.now + requireKnown(config.health.timeout, "us"), 1, JSON.stringify(["health-timeout", key]), () => { observe(false, "health-timeout"); receipt?.cancel(); });
      receipt = path(member.id).exchange({ rootId: key, callId: key, attempt: 0, operation: config.health.operation, offeredAt: kernel.now }, (result) => observe(result.ok, result.ok ? "passed" : result.reason!));
      trace("health-probe", key, member.id);
      const next = kernel.now + requireKnown(config.health.interval, "us");
      if (next <= horizon) member.cancelCheck = kernel.schedule(next, 3, JSON.stringify(["health-check", config.id, member.id]), check);
    };
    member.cancelCheck = kernel.schedule(0, 3, JSON.stringify(["health-check", config.id, member.id]), check);
  }
  return {
    accept(work: Invocation, done: Request["done"]): Receipt {
      received++;
      if (active.size >= requireKnown(config.maxOutstanding, "count") && pending.size >= requireKnown(config.maxPending, "count")) { rejected++; trace("lb-failure", work.callId, "pending-overflow", work.rootId, work.attempt); done("rejected"); return { admitted: false, state: () => "finished", cancel: () => "already-finished" }; }
      const r: Request = { work, done, attempt: 0, retrying: false, terminal: false }; pending.set(work.callId, r);
      r.timer = kernel.schedule(kernel.now + requireKnown(config.pendingTimeout, "us"), 1, JSON.stringify(["lb-pending-timeout", config.id, work.callId]), () => { trace("lb-failure", work.callId, "pending-timeout", work.rootId, work.attempt); finish(r, "rejected"); }); pump();
      return { admitted: true, state: () => r.terminal ? "finished" : pending.has(work.callId) ? "queued" : "waiting", cancel: () => {
        if (r.terminal) return "already-finished";
        finish(r, "cancelled"); r.receipt?.cancel(); return "cancelled";
      } };
    },
    drain(backend: string, grace: number) { const m = members.find((m) => m.id === backend)!; m.draining = true; m.cancelCheck?.(); path(backend).drain(grace); trace("backend-draining", config.id, `${backend}:${grace}us`); },
    measure: () => ({ id: config.id, received, completed, rejected, cancelled, active: active.size, pending: pending.size, attempts, retries, retryLimited, activeRetries,
      backends: members.map(({ cancelCheck: _cancel, ...m }) => ({ ...m })) }),
  };
}
