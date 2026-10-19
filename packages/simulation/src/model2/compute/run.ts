import { requireKnown } from "../../reality/quantity";
import type { ComputeInput, ComputeState } from "./contracts";
import type { WorkloadInput } from "../workload/contracts";
import { createWorkloadRuntime } from "../workload/run";
import { workloadStation } from "../workload/station";
import { computeResource } from "./resource";
import { computeModules } from "./module";
import { validateCompute, isCompute, isComputeProfile } from "./validate";
import { COMPUTE_POLICY_LEDGER } from "./policy";
import { validateWorkload } from "../workload/validate";
import { lexical } from "../time";
import type { EventKernel } from "../time";
import type { Invocation, Receipt, RemoteOutcome } from "../workload/contracts";
import type { WorkEndpoint } from "../workload/run";
import type { CausalObserver } from "../workload/causal";
import type { CpuOwners, ClockOwners } from "../composition/host";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export type Deliver = (target: string, work: Invocation, done: (outcome: RemoteOutcome) => void) => Receipt;
export interface ComputeComposition {
  send(source: string, target: string, work: Invocation, done: (outcome: RemoteOutcome) => void): Receipt;
  receive(target: string, work: Invocation, done: (outcome: RemoteOutcome) => void, direct: () => Receipt): Receipt;
}
export type ResourceFactory = (id: string, kernel: EventKernel, send: Deliver) => WorkEndpoint<ComputeState> | undefined;
export function createComputeModel2(authored: ComputeInput) {
  return createComputeRuntime(authored);
}
const adapt = (source: ComputeInput): WorkloadInput => ({ ...source, workloadVersion: "m2b/1",
    profiles: source.profiles.map((p) => isComputeProfile(p) ? { ...p, schema: "infraforge-demand/1", io: p.blockingWait } : p),
    resources: source.resources.map((r) => isCompute(r) ? { ...r, concurrency: r.workers } : r) });
export function validateComputeInput(authored: ComputeInput) {
  // Preserve M2B's pre-copy trace/request budgets at the new resource seam.
  validateWorkload(adapt(authored));
  validateCompute(authored);
}
export function createComputeRuntime(authored: ComputeInput, compose?: (kernel: EventKernel, deliver: Deliver, controls: { pause(id: string, value: boolean): void; observe(id: string): unknown; abortOwned(id: string): void }) => ComputeComposition, resourceFactory?: ResourceFactory, causal?: CausalObserver, cpuFor?: CpuOwners, clockFor?: ClockOwners) {
  validateComputeInput(authored);
  const input: ComputeInput = JSON.parse(JSON.stringify(authored));
  for (const list of [input.resources, input.profiles, input.operations, input.arrivals, input.faults, input.ledger, input.interventions]) list.sort((a, b) => lexical(a.id, b.id));
  const adapter = adapt(input);
  const computes = new Map<string, ReturnType<typeof computeResource>>();
  const modules = computeModules(input, computes);
  let composition: ComputeComposition | undefined;
  let deliverEntry: Deliver;
  const interventionEvidence: Array<{ id: string; at: number; state: string }> = [];
  const runtime = createWorkloadRuntime<ComputeState>(adapter, {
    causal,
    clockFor,
    station(config, demands, kernel, send) {
      const original = input.resources.find((r) => r.id === config.id)!;
      const external = resourceFactory?.(original.id, kernel, (target, work, done) => composition ? composition.send(original.id, target, work, done) : send(target, work, done));
      if (external) return external;
      const routedSend: Deliver = (target, work, done) => composition ? composition.send(original.id, target, work, done) : send(target, work, done);
      if (!modules.has(original.kind)) return workloadStation(config, demands, kernel, routedSend);
      return modules.create(original, { clock: clockFor?.(original.id, kernel) ?? kernel, send: routedSend, causal, cpu: cpuFor?.(original.id, kernel) });
    },
    route: (target, work, done, direct) => composition ? composition.receive(target, work, done, direct) : direct(),
    enter: (target, work, done) => composition ? composition.send("$caller", target, work, done) : deliverEntry(target, work, done),
    install(kernel, _stations, send) {
      deliverEntry = send; composition = compose?.(kernel, send, { pause: (id, value) => _stations.get(id)!.pause(value), observe: (id) => _stations.get(id)?.measure(), abortOwned: (id) => computes.get(id)?.abortOwned() });
      for (const i of [...input.interventions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
        const clock = clockFor?.(i.target, kernel) ?? kernel;
        const at = requireKnown(i.at, "us"), resource = computes.get(i.target)!;
        clock.schedule(at, 0, JSON.stringify(["compute-intervention", i.id]), () => {
          if (i.kind === "capacity") resource.setCapacity(requireKnown(i.cores, "cores"));
          else resource.competitor(JSON.stringify(["competitor", i.id]), requireKnown(i.demand, "cpu-us"), requireKnown(i.parallelism, "cores"));
          interventionEvidence.push({ id: i.id, at: kernel.now, state: "applied" });
        });
        if (i.kind === "competitor") clock.schedule(at + requireKnown(i.duration, "us"), -1, JSON.stringify(["compute-intervention-end", i.id]), () => {
          resource.removeCompetitor(JSON.stringify(["competitor", i.id])); interventionEvidence.push({ id: i.id, at: kernel.now, state: "ended" });
        });
      }
    },
  });
  return { horizon: runtime.horizon, advanceTo: runtime.advanceTo,
    evidence() { const e = runtime.evidence();
      const intervals = e.samples.slice(1).flatMap((sample, index) => sample.resources.flatMap((resource) => {
        const current = resource.compute?.cpu, previous = e.samples[index]!.resources.find((r) => r.id === resource.id)?.compute?.cpu;
        if (!current || !previous) return [];
        const appCoreUs = current.appCoreUs - previous.appCoreUs, competitorCoreUs = current.competitorCoreUs - previous.competitorCoreUs, availableCoreUs = current.availableCoreUs - previous.availableCoreUs;
        return [{ resource: resource.id, fromUs: e.samples[index]!.at, toUs: sample.at, appCoreUs, competitorCoreUs, availableCoreUs,
          utilization: availableCoreUs > 0 ? { kind: "known", unit: "ratio", app: appCoreUs / availableCoreUs, total: (appCoreUs + competitorCoreUs) / availableCoreUs } : { kind: "unknown", unit: "ratio", reason: "No available core-time in interval" } }];
      }));
      return { ...e, workloadVersion: "m2c/1" as const, intervals, computePolicyLedger: copy(COMPUTE_POLICY_LEDGER), computeProfiles: copy(input.profiles.filter(isComputeProfile)), computeConfiguration: copy(input.resources.filter(isCompute)), interventions: copy(interventionEvidence),
      unmodeled: ["network transport latency", "cost", "database locks", "packet loss", "GC", "reclaim/swap/OOM", "physical topology/SMT/frequency behavior outside calibrated workload points"] }; } };
}
