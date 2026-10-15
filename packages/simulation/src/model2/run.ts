import { EventKernel, lexical } from "./time";
import { requireKnown } from "../reality/quantity";
import { serviceStation } from "./station";
import type { Model2Input, ResourceBehavior, Work, WorkOutcome } from "./contracts";
import { validateModel2 } from "./validate";
import { FOUNDATION_LEDGER, METRIC_DEFINITIONS } from "./provenance";

export function createModel2(input: Model2Input) {
  // Capture a private input snapshot so a caller cannot change scheduled physics.
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  validateModel2(input); input = copy(input);
  input.resources.sort((a, b) => lexical(a.id, b.id));
  for (const r of input.resources) if (r.kind === "router") r.backends.sort(lexical);
  input.workload.sort((a, b) => lexical(a.id, b.id)); input.faults.sort((a, b) => lexical(a.id, b.id));
  input.ledger.sort((a, b) => lexical(a.id, b.id));
  const kernel = new EventKernel(input.limits.maxEvents), behaviors = new Map<string, ResourceBehavior>();
  const routers = new Map(input.resources.filter((r) => r.kind === "router").map((r) => [r.id, { backends: [...r.backends].sort(lexical), next: 0 }]));
  const routes = new Map<string, string[]>();
  const results: Array<{ id: string; at: number; outcome: WorkOutcome; latencyUs: number }> = [];
  const inFlight = new Map<string, Work>();
  const faultEvidence: Array<{ id: string; at: number; state: "applied" | "ended" }> = [];
  const samples: Array<{ at: number; completed: number; failed: number; inFlight: number; resources: ReturnType<ResourceBehavior["measure"]>[] }> = [];
  const send = (target: string, work: Work, done: (outcome: WorkOutcome) => void) => {
    const router = routers.get(target);
    if (router) {
      const backend = router.backends[router.next++ % router.backends.length]!; send(backend, work, done); return;
    }
    routes.set(work.id, [...(routes.get(work.id) ?? []), target]); behaviors.get(target)!.accept(work, done);
  };
  // Cancel from the caller inward. Each station removes only its own retained work.
  const cancel = (target: string, id: string) => behaviors.get(target)?.cancel(id);
  for (const config of [...input.resources].sort((a, b) => lexical(a.id, b.id))) if (config.kind !== "router")
    behaviors.set(config.id, serviceStation(config, { kernel, send, cancel }));
  let completed = 0, failed = 0;
  for (const c of [...input.workload].sort((a, b) => lexical(a.id, b.id))) {
    const count = requireKnown(c.count, "count"), interval = requireKnown(c.interval, "us"), start = requireKnown(c.start, "us"), timeout = requireKnown(c.timeout, "us");
    // Schedule arrivals lazily; future workload size does not fill the event heap.
    const arrival = (index: number) => {
      const at = start + index * interval;
      if (index >= count || at > requireKnown(input.horizon, "us")) return;
      kernel.schedule(at, 3, `arrival/${c.id}/${index}`, () => {
        const work = { id: `${c.id}/${index}`, classId: c.id, arrived: kernel.now, deadline: kernel.now + timeout };
        inFlight.set(work.id, work);
        const done = (outcome: WorkOutcome) => {
          if (!inFlight.delete(work.id)) return;
          if (outcome === "completed") completed++; else failed++;
          results.push({ id: work.id, at: kernel.now, outcome, latencyUs: kernel.now - work.arrived }); routes.delete(work.id);
        };
        kernel.schedule(work.deadline, 1, `deadline/${work.id}`, () => {
          if (!inFlight.has(work.id)) return;
          const path = routes.get(work.id) ?? [];
          // Suppress callbacks first; cancellation is a local timeout, never a completion.
          done("timed-out"); for (const target of path) cancel(target, work.id);
        });
        send(c.entry, work, done); arrival(index + 1);
      });
    };
    arrival(0);
  }
  for (const f of [...input.faults].sort((a, b) => lexical(a.id, b.id))) {
    const at = requireKnown(f.at, "us"), end = at + requireKnown(f.duration, "us");
    for (const [time, active] of [[at, true], [end, false]] as const) kernel.schedule(time, active ? 0 : -1, `fault/${f.id}/${active ? "start" : "end"}`, () => {
      behaviors.get(f.target)!.fault(active); faultEvidence.push({ id: f.id, at: kernel.now, state: active ? "applied" : "ended" });
    });
  }
  const horizon = requireKnown(input.horizon, "us"), step = requireKnown(input.sampleInterval, "us");
  let executionFailure: string | null = null;
  const sample = (at: number) => kernel.schedule(at, 4, `sample/${at}`, () => {
    samples.push({ at: kernel.now, completed, failed, inFlight: inFlight.size, resources: [...behaviors.values()].map((b) => b.measure()) });
    if (at < horizon) sample(Math.min(at + step, horizon));
  });
  sample(0);
  return { advanceTo: (until: number) => {
      if (executionFailure) throw new Error("Execution failed; no resume is available");
      if (until > horizon) throw new Error("Beyond authored horizon");
      try { kernel.advanceTo(until); } catch (error) { executionFailure = (error as Error).message; throw error; }
    },
    evidence: () => copy({ modelVersion: "2", status: "internal-proof", throughUs: kernel.now, samples, results, faults: faultEvidence,
      inputs: input,
      capture: { complete: kernel.now === horizon && !executionFailure, failure: executionFailure },
      provenance: { revision: "2-m2a-v1", inputLedger: input.ledger, foundationLedger: FOUNDATION_LEDGER, metrics: METRIC_DEFINITIONS },
      cost: { kind: "unknown", unit: "USD", provenance: ["m2.unpriced"], reason: "No dated provider/region tariff supplied" },
      execution: { events: kernel.processed, peakPending: kernel.peakPending } }), horizon };
}
