import { requireKnown, validateQuantity, type Quantity, type Unit } from "../../reality/quantity";
import type { ComputeInput, ComputeResource, ComputeProfile } from "./contracts";
import { micros } from "../time";
import { COMPUTE_LIMITS } from "./policy";

export function validateCompute(input: ComputeInput) {
  if (input.workloadVersion !== "m2c/1" || input.resources.length > 256 || input.profiles.length > 16384 || input.interventions.length > COMPUTE_LIMITS.interventions) throw new Error("Invalid compute revision/structural budget");
  const ledger = new Map(input.ledger.map((e) => [e.id, e.quantity]));
  const check = (q: Quantity, unit: Unit, min = 0, unknown = false, integer = false) => {
    if (validateQuantity(q).length || q.unit !== unit || (!unknown && q.kind !== "known")) throw new Error(`Unknown/invalid compute ${unit}`);
    for (const id of q.provenance) {
      const e = ledger.get(id);
      if (!e || e.unit !== q.unit || e.kind !== q.kind || (e.kind === "known" && q.kind === "known" && e.value !== q.value) || (e.kind === "range" && q.kind === "range" && (e.min !== q.min || e.max !== q.max)) || (e.kind === "unknown" && q.kind === "unknown" && e.reason !== q.reason)) throw new Error(`Missing exact compute provenance: ${id}`);
    }
    if (q.kind === "known" && (q.value < min || (integer && !Number.isSafeInteger(q.value)))) throw new Error("Invalid compute quantity bounds");
    if (q.kind === "range" && (q.min < min || (integer && (!Number.isSafeInteger(q.min) || !Number.isSafeInteger(q.max))))) throw new Error("Invalid memory bound");
  };
  const components = (parts: Array<{ id: string; owner: string; bytes: Quantity<"bytes"> }>, owners: string[]) => {
    if (parts.length > COMPUTE_LIMITS.memoryComponents || new Set(parts.map((p) => p.id)).size !== parts.length || parts.some((p) => !p.id || !owners.includes(p.owner))) throw new Error("Invalid resident component ownership/budget");
    for (const p of parts) check(p.bytes, "bytes", 0, true, true);
  };
  const defined = <T>(q: T | undefined): q is T => q !== undefined;
  for (const p of input.profiles) if (p.schema === "infraforge-compute-demand/1") {
    check(p.maxCpuParallelism, "cores", Number.MIN_VALUE); check(p.blockingWait, "us", 0, false, true);
    if (!["complete-model", "partial"].includes(p.residentCoverage)) throw new Error("Resident profile coverage required");
    for (const q of [p.requestResidentBytes, p.activeResidentBytes].filter(defined)) check(q, "bytes", 0, true, true);
    components(p.residentComponents ?? [], ["admitted", "active"]);
  }
  const resources = new Map(input.resources.map((r) => [r.id, r]));
  for (const r of input.resources) if (r.kind === "compute") {
    if (!Number.isFinite(requireKnown(r.cores, "cores") * requireKnown(input.horizon, "us"))) throw new Error("Available core-time overflow");
    if (r.scheduler !== "capped-equal-fluid/1" || requireKnown(r.workers, "count") > COMPUTE_LIMITS.workers || !["observe", "reject-allocation"].includes(r.memory.policy)) throw new Error("Unsupported scheduler/workers/memory policy");
    if (!["complete-model", "partial"].includes(r.memory.coverage)) throw new Error("Resident process coverage required");
    for (const q of [r.memory.baseline, r.memory.perWorker, r.memory.retained].filter(defined)) check(q, "bytes", 0, true, true);
    components(r.memory.components ?? [], ["process", "worker"]);
    if (r.memory.limit) check(r.memory.limit, "bytes", 0, false, true);
    const base = [r.memory.baseline, r.memory.perWorker, r.memory.retained, ...(r.memory.components ?? []).map((p) => p.bytes)].filter(defined);
    if (r.memory.policy === "reject-allocation" && r.memory.limit && base.every((q) => q.kind === "known")) {
      const baseline = (r.memory.baseline ? requireKnown(r.memory.baseline, "bytes") : 0) + (r.memory.perWorker ? requireKnown(r.memory.perWorker, "bytes") * requireKnown(r.workers, "count") : 0) + (r.memory.retained ? requireKnown(r.memory.retained, "bytes") : 0) + (r.memory.components ?? []).reduce((sum, p) => sum + requireKnown(p.bytes, "bytes") * (p.owner === "worker" ? requireKnown(r.workers, "count") : 1), 0);
      if (!Number.isSafeInteger(baseline) || baseline > requireKnown(r.memory.limit, "bytes")) throw new Error("Initial modeled memory cannot satisfy hard allocation policy");
    }
    for (const op of input.operations) {
      const p = input.profiles.find((p) => p.id === r.profiles[op.id]);
      if (!p || p.schema !== "infraforge-compute-demand/1") throw new Error("Compute requires a compute-specific demand profile");
      if (!Number.isFinite(requireKnown(p.maxCpuParallelism, "cores") * requireKnown(r.workers, "count") * requireKnown(input.horizon, "us"))) throw new Error("Parallelism integral overflow");
      if (r.memory.policy === "reject-allocation" && (!r.memory.limit || r.memory.coverage !== "complete-model" || p.residentCoverage !== "complete-model" || [...base, p.requestResidentBytes, p.activeResidentBytes, ...(p.residentComponents ?? []).map((p) => p.bytes)].filter(defined).some((q) => q.kind !== "known"))) throw new Error("Hard allocation policy requires complete known modeled memory");
    }
    if (r.quota) {
      check(r.quota.budget, "cpu-us", Number.MIN_VALUE); check(r.quota.period, "us", 1, false, true);
      if (requireKnown(input.horizon, "us") / requireKnown(r.quota.period, "us") > COMPUTE_LIMITS.quotaBoundaries) throw new Error("Quota boundary budget exceeded");
    }
  }
  const ids = new Set<string>(), capacityTimes = new Set<string>();
  for (const i of input.interventions) {
    if (!i.id || ids.has(i.id) || resources.get(i.target)?.kind !== "compute") throw new Error("Invalid compute intervention identity/target"); ids.add(i.id);
    check(i.at, "us", 0, false, true);
    if (i.kind === "capacity") {
      check(i.cores, "cores"); const key = JSON.stringify([i.target, requireKnown(i.at, "us")]);
      if (!Number.isFinite(requireKnown(i.cores, "cores") * requireKnown(input.horizon, "us"))) throw new Error("Capacity integral overflow");
      if (capacityTimes.has(key)) throw new Error("Ambiguous simultaneous capacity changes"); capacityTimes.add(key);
      const resource = resources.get(i.target)!;
      if (resource.kind === "compute") for (const id of Object.values(resource.profiles)) {
        const bound = input.profiles.find((p) => p.id === id)?.validity.ranges.cores, value = requireKnown(i.cores, "cores");
        if (bound && (value < bound.min || value > bound.max)) throw new Error("Unknown capacity intervention outside profile validity domain");
      }
    } else if (i.kind === "competitor") {
      check(i.demand, "cpu-us", Number.MIN_VALUE); check(i.parallelism, "cores", Number.MIN_VALUE); check(i.duration, "us", 1, false, true);
      if (!Number.isFinite(requireKnown(i.parallelism, "cores") * input.interventions.length * requireKnown(input.horizon, "us"))) throw new Error("Competitor parallelism integral overflow");
      micros(requireKnown(i.at, "us") + requireKnown(i.duration, "us"));
    } else throw new Error("Unsupported compute intervention");
  }
}
export const isCompute = (r: ComputeInput["resources"][number]): r is ComputeResource => r.kind === "compute";
export const isComputeProfile = (p: ComputeInput["profiles"][number]): p is ComputeProfile => p.schema === "infraforge-compute-demand/1";
