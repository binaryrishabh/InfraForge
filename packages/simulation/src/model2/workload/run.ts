import { EventKernel, lexical, type EventClock } from "../time";
import { requireKnown } from "../../reality/quantity";
import { identity, ingestTrace, openRows } from "./arrivals";
import { ResultBook } from "./evidence";
import { validateWorkload } from "./validate";
import { workloadStation } from "./station";
import { WORKLOAD_POLICY_LEDGER } from "./policy";
import type { CallerOutcome, Invocation, Receipt, RemoteOutcome, TraceRow, WorkloadInput, WorkStation, StationState } from "./contracts";
import type { CausalObserver } from "./causal";

export interface WorkEndpoint<M extends StationState> {
  accept(work: Invocation, done: (outcome: RemoteOutcome) => void): Receipt;
  pause(value: boolean): void;
  measure(): M;
}
export interface RuntimeModules<M extends StationState> {
  clockFor?(id: string, kernel: EventKernel): EventClock;
  causal?: CausalObserver;
  station(config: WorkStation, demands: Map<string, { cpuUs: number; ioUs: number }>, kernel: EventKernel, send: (target: string, work: Invocation, done: (outcome: RemoteOutcome) => void) => Receipt): WorkEndpoint<M>;
  install?(kernel: EventKernel, stations: Map<string, WorkEndpoint<M>>, send: (target: string, work: Invocation, done: (outcome: RemoteOutcome) => void) => Receipt): void;
  route?(target: string, work: Invocation, done: (outcome: RemoteOutcome) => void, direct: () => Receipt): Receipt;
  enter?(target: string, work: Invocation, done: (outcome: RemoteOutcome) => void): Receipt;
}

// Separate internal workload revision; no public export, HTTP route or Model-1 dispatch.
export function createWorkloadModel2(authored: WorkloadInput) {
  return createWorkloadRuntime(authored, { station: workloadStation });
}

// Resource modules share arrival/identity/caller/evidence ownership, not physics.
export function createWorkloadRuntime<M extends StationState>(authored: WorkloadInput, modules: RuntimeModules<M>) {
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  // Enforce structural budgets before duplicating a potentially large authored trace.
  const demands = validateWorkload(authored), input = copy(authored);
  for (const list of [input.resources, input.operations, input.arrivals, input.profiles, input.faults, input.ledger]) list.sort((a, b) => lexical(a.id, b.id));
  for (const r of input.resources) if (r.kind === "router") r.backends.sort(lexical);
  for (const a of input.arrivals) if (a.kind === "trace") a.trace = ingestTrace(a.trace, a.trace.rows, input.limits.maxTraceRows, new Set(input.operations.map((o) => o.id)));
  const kernel = new EventKernel(input.limits.maxEvents), horizon = requireKnown(input.horizon, "us"), step = requireKnown(input.sampleInterval, "us");
  const stations = new Map<string, WorkEndpoint<M>>();
  const routers = new Map(input.resources.filter((r) => r.kind === "router").map((r) => [r.id, { backends: r.backends, next: 0 }]));
  const send = (target: string, work: Invocation, done: (outcome: RemoteOutcome) => void): Receipt => {
    const direct = () => {
      const router = routers.get(target);
      if (router) return send(router.backends[router.next++ % router.backends.length]!, work, done);
      return stations.get(target)!.accept(work, done);
    };
    return modules.route ? modules.route(target, work, done, direct) : direct();
  };
  for (const r of input.resources) if (r.kind !== "router") stations.set(r.id, modules.station(r, demands.get(r.id)!, kernel, send));
  modules.install?.(kernel, stations, send);
  const operations = new Map(input.operations.map((o) => [o.id, o]));
  const live = new Map<string, { work: Invocation; receipt?: Receipt }>();
  const book = new ResultBook(input.limits.maxRawResults);
  const counts = { offered: 0, admitted: 0, completed: 0, rejected: 0, deadlineExceeded: 0, abandoned: 0, remoteOutcomesAfterCallerStop: 0, cancellationRequested: 0, cancellationConfirmedAtEntry: 0 };
  const byOperation = new Map(input.operations.map((o) => [o.id, { offered: 0, completed: 0, rejected: 0, deadlineExceeded: 0, abandoned: 0 }]));
  const sources = new Map(input.arrivals.map((a) => [a.id, { offered: 0 }]));
  const offer = (source: string, row: TraceRow, next?: () => void) => {
    if (++counts.offered > input.limits.maxRequests) throw new Error("Request execution budget exceeded");
    sources.get(source)!.offered++;
    const operation = operations.get(row.operation)!, perOperation = byOperation.get(row.operation)!; perOperation.offered++;
    const rootId = identity("root", source, row.id), callId = identity(rootId, "attempt", 0, "entry");
    const work: Invocation = { rootId, attempt: 0, callId, operation: operation.id, offeredAt: kernel.now, ...(row.payloadBytes === undefined ? {} : { payloadBytes: row.payloadBytes }) };
    modules.causal?.({ atUs: kernel.now, kind: "caller-offered", resource: "$caller", work, detail: {} });
    const pending: { work: Invocation; receipt?: Receipt } = { work }; live.set(rootId, pending);
    let terminal = false, cancelDeadline: (() => boolean) | undefined, cancelAbandon: (() => boolean) | undefined;
    const finish = (outcome: CallerOutcome) => {
      if (terminal) return;
      terminal = true; live.delete(rootId); cancelDeadline?.(); cancelAbandon?.();
      const key = outcome === "deadline-exceeded" ? "deadlineExceeded" : outcome;
      counts[key]++; perOperation[key]++;
      modules.causal?.({ atUs: kernel.now, kind: "caller-terminal", resource: "$caller", work, detail: { outcome, responseUs: kernel.now - work.offeredAt } });
      book.record({ ...work, at: kernel.now, outcome, responseUs: kernel.now - work.offeredAt }); next?.();
    };
    const stop = (outcome: "deadline-exceeded" | "abandoned") => {
      finish(outcome);
      if (operation.onCallerStop === "request-cancellation" && pending.receipt) {
        counts.cancellationRequested++;
        if (pending.receipt.cancel() === "cancelled") counts.cancellationConfirmedAtEntry++;
      }
    };
    cancelDeadline = kernel.schedule(kernel.now + requireKnown(operation.callerTimeout, "us"), 1, identity("caller-stop", rootId, 0), () => stop("deadline-exceeded"));
    if (operation.abandonAfter) cancelAbandon = kernel.schedule(kernel.now + requireKnown(operation.abandonAfter, "us"), 1, identity("caller-stop", rootId, 1), () => stop("abandoned"));
    pending.receipt = (modules.enter ?? send)(operation.entry, work, (outcome) => {
      if (terminal) { counts.remoteOutcomesAfterCallerStop++; return; }
      finish(outcome === "completed" ? "completed" : "rejected");
    });
    if (pending.receipt.admitted) counts.admitted++;
  };
  const scheduleRow = (source: string, row: TraceRow, next?: () => void, offered?: () => void) => {
    if (row.atUs <= horizon) kernel.schedule(row.atUs, 3, identity("arrival", source, row.id), () => { offer(source, row, next); offered?.(); });
  };
  for (const a of input.arrivals) {
    if (a.kind === "closed") {
      const users = requireKnown(a.users, "count"), perUser = requireKnown(a.perUser, "count"), think = requireKnown(a.think, "us");
      for (let user = 0; user < users; user++) {
        const issue = (index: number, at: number) => {
          if (index < perUser) scheduleRow(a.id, { id: identity("user", user, index), atUs: at, operation: a.operation }, () => issue(index + 1, kernel.now + think));
        };
        issue(0, requireKnown(a.start, "us"));
      }
    } else {
      const iterator = openRows(a, input.seed);
      const advance = () => { const row = iterator.next(); if (!row.done) scheduleRow(a.id, row.value, undefined, advance); };
      advance();
    }
  }
  const faults: Array<{ id: string; at: number; active: boolean }> = [];
  for (const f of input.faults) for (const active of [true, false]) {
    const at = requireKnown(f.at, "us") + (active ? 0 : requireKnown(f.duration, "us"));
    (modules.clockFor?.(f.target, kernel) ?? kernel).schedule(at, active ? 0 : -1, identity("fault", f.id, active ? "start" : "end"), () => { stations.get(f.target)!.pause(active); faults.push({ id: f.id, at: kernel.now, active }); });
  }
  const snapshot = () => ({ at: kernel.now, counts: { ...counts, inFlight: live.size }, resources: [...stations.values()].map((s) => s.measure()) });
  const samples: ReturnType<typeof snapshot>[] = [];
  const sample = (at: number) => kernel.schedule(at, 4, identity("sample", at), () => { samples.push(snapshot()); if (at < horizon) sample(Math.min(at + step, horizon)); });
  sample(0);
  let failure: string | null = null;
  return {
    horizon,
    advanceTo(until: number) {
      if (failure) throw new Error("Failed execution cannot resume");
      if (until > horizon) throw new Error("Beyond authored horizon");
      try { kernel.advanceTo(until); } catch (e) { failure = (e as Error).message; throw e; }
    },
    evidence() {
      const state = snapshot(), terminal = counts.completed + counts.rejected + counts.deadlineExceeded + counts.abandoned;
      return copy({ modelVersion: "2", workloadVersion: input.workloadVersion, status: "internal", seed: input.seed,
        capture: { throughUs: kernel.now, reachedHorizon: kernel.now === horizon && !failure, failure },
        ...state, samples, faults, byOperation: Object.fromEntries(byOperation), sources: Object.fromEntries(sources),
        results: book.raw, resultRetention: { terminal, retained: book.raw.length, omitted: terminal - book.raw.length },
        distributions: { population: "terminal caller outcomes by operation/outcome; in-flight requests are right-censored", censored: live.size, groups: book.summary() },
        inFlight: [...live.values()].slice(0, input.limits.maxRawResults).map(({ work, receipt }) => ({ ...work, state: receipt?.state(), ageUs: kernel.now - work.offeredAt })),
        inFlightOmitted: Math.max(0, live.size - input.limits.maxRawResults),
        execution: { processed: kernel.processed, cancelled: kernel.cancelled, pending: kernel.pending, peakPending: kernel.peakPending },
        provenance: { profiles: input.profiles, ledger: input.ledger, policyLedger: WORKLOAD_POLICY_LEDGER, configuration: { resources: input.resources, operations: input.operations, limits: input.limits },
          arrivals: input.arrivals.map((a) => a.kind === "trace" ? { id: a.id, kind: a.kind, schema: a.trace.schema, durationUs: a.trace.durationUs, rows: a.trace.rows.length, provenance: a.trace.provenance } : a) },
        unmodeled: ["network transport latency", "memory", "cost", "locks", "packet loss"],
      });
    },
  };
}
