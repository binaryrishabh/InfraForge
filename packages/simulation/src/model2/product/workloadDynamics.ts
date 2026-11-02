import { workloadDynamicsError, type WorkloadProfile } from "@infraforge/domain/workload";
import { APP_CPU_DISTRIBUTION } from "../compute/demand";
import type { ProductContract } from "./contracts";

export function arrivalVersion(p: WorkloadProfile): "product-arrivals/1" | "product-arrivals/2" {
  const error = workloadDynamicsError(p.workloadDynamics); if (error) throw Error(error);
  return p.workloadDynamics?.arrivalProcess === "poisson" ? "product-arrivals/2" : "product-arrivals/1";
}

export function compileCpuDynamics(p: WorkloadProfile, contract: ProductContract) {
  const cv = p.workloadDynamics?.applicationCpuCv ?? 0;
  if (cv === 0) return;
  const flow = contract.applicationFlowProfile ? `/${contract.applicationFlowProfile}` : "";
  contract.version = (flow ? contract.version.slice(0, -flow.length) : contract.version) + "/app-cpu-demand/1" + flow;
  for (const demand of contract.application!.demands) if (demand.schema === "infraforge-compute-demand/1") demand.cpuDistribution = { schema: "app-cpu-demand/1", cv, provenance: APP_CPU_DISTRIBUTION };
}

export function checkCpuDynamics(p: WorkloadProfile, contract: ProductContract) {
  arrivalVersion(p);
  const cv = p.workloadDynamics?.applicationCpuCv ?? 0;
  for (const demand of contract.application?.demands ?? []) {
    if (demand.schema !== "infraforge-compute-demand/1") continue;
    const d = demand.cpuDistribution;
    if (cv > 0 ? !d || d.cv !== cv || d.schema !== "app-cpu-demand/1" || d.provenance !== APP_CPU_DISTRIBUTION : d !== undefined) throw Error("Application CPU descriptor must match saved workload dynamics");
  }
}
