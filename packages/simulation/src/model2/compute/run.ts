import { requireKnown } from "../../reality/quantity";
import type { ComputeInput, ComputeState } from "./contracts";
import type { WorkloadInput } from "../workload/contracts";
import { createWorkloadRuntime } from "../workload/run";
import { workloadStation } from "../workload/station";
import { computeResource } from "./resource";
import { validateCompute, isCompute, isComputeProfile } from "./validate";
import { COMPUTE_POLICY_LEDGER } from "./policy";
import { validateWorkload } from "../workload/validate";
import { lexical } from "../time";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function createComputeModel2(authored: ComputeInput) {
  const adapt = (source: ComputeInput): WorkloadInput => ({ ...source, workloadVersion: "m2b/1",
    profiles: source.profiles.map((p) => isComputeProfile(p) ? { ...p, schema: "infraforge-demand/1", io: p.blockingWait } : p),
    resources: source.resources.map((r) => isCompute(r) ? { ...r, concurrency: r.workers } : r) });
  // Preserve M2B's pre-copy trace/request budgets at the new resource seam.
  validateWorkload(adapt(authored));
  validateCompute(authored);
  const input: ComputeInput = JSON.parse(JSON.stringify(authored));
  for (const list of [input.resources, input.profiles, input.operations, input.arrivals, input.faults, input.ledger, input.interventions]) list.sort((a, b) => lexical(a.id, b.id));
  const adapter = adapt(input);
  const computes = new Map<string, ReturnType<typeof computeResource>>();
  const interventionEvidence: Array<{ id: string; at: number; state: string }> = [];
  const runtime = createWorkloadRuntime<ComputeState>(adapter, {
    station(config, demands, kernel, send) {
      const original = input.resources.find((r) => r.id === config.id)!;
      if (!isCompute(original)) return workloadStation(config, demands, kernel, send);
      const profiles = new Map(input.operations.map((o) => [o.id, input.profiles.find((p) => p.id === original.profiles[o.id])!]).filter((pair): pair is [string, Extract<ComputeInput["profiles"][number], { schema: "infraforge-compute-demand/1" }>] => typeof pair[0] === "string" && typeof pair[1] === "object" && isComputeProfile(pair[1])));
      const resource = computeResource(original, profiles, kernel, send); computes.set(original.id, resource); return resource;
    },
    install(kernel) {
      for (const i of [...input.interventions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
        const at = requireKnown(i.at, "us"), resource = computes.get(i.target)!;
        kernel.schedule(at, 0, JSON.stringify(["compute-intervention", i.id]), () => {
          if (i.kind === "capacity") resource.setCapacity(requireKnown(i.cores, "cores"));
          else resource.competitor(JSON.stringify(["competitor", i.id]), requireKnown(i.demand, "cpu-us"), requireKnown(i.parallelism, "cores"));
          interventionEvidence.push({ id: i.id, at: kernel.now, state: "applied" });
        });
        if (i.kind === "competitor") kernel.schedule(at + requireKnown(i.duration, "us"), -1, JSON.stringify(["compute-intervention-end", i.id]), () => {
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
