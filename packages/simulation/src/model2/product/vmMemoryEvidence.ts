import type { VmMemoryMetrics, VmMemoryReading } from "@infraforge/contracts/telemetry";
import type { ComputeState } from "../compute/contracts";
import type { CompiledProduct } from "./contracts";
import { requireKnown } from "../../reality/quantity";
import { VM_MEMORY_PROFILE } from "./vmMemory";

export function vmMemoryEvidence(compiled: CompiledProduct, inspect: (id: string) => unknown) {
  const owners = new Set(compiled.semantic.nodes.filter(n => n.profile.includes(`/${VM_MEMORY_PROFILE}`)).map(n => n.id));
  const resources = compiled.input.resources.filter(r => r.kind === "compute" && !r.id.includes("/") && owners.has(r.id.split("#")[0]!));
  if (!resources.length) return;
  // One scalar per compiled VM, updated at ownership transitions rather than sampling.
  const peaks = new Map(resources.map(r => [r.id, r.kind === "compute" && r.memory.baseline ? requireKnown(r.memory.baseline, "bytes") : 0]));
  const observe = (id: string) => {
    if (!peaks.has(id)) return;
    const m = (inspect(id) as ComputeState | undefined)?.compute?.memory;
    if (m?.totalResidentBytes.kind === "known") peaks.set(id, Math.max(peaks.get(id)!, m.totalResidentBytes.value));
  };
  const measure = (): VmMemoryMetrics => ({ version: 1, resources: resources.map((r): VmMemoryReading => {
    const state = inspect(r.id) as ComputeState | undefined, m = state?.compute?.memory;
    const residentBytes = m?.totalResidentBytes.kind === "known" ? m.totalResidentBytes.value : null;
    const limitBytes = m?.limitBytes ?? null;
    return { id: r.id, residentBytes, limitBytes, headroomBytes: residentBytes === null || limitBytes === null ? null : limitBytes - residentBytes,
      holdingRequests: m?.ownership.requests ?? null, activeRequests: m?.ownership.active ?? null, allocationRejected: state?.compute?.allocationRejected ?? null,
      comparison: m?.comparison ?? "unknown", peakResidentBytes: peaks.get(r.id) ?? null };
  }) });
  return { observe, measure };
}
