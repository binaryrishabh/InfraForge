import { workloadDynamicsError, type WorkloadProfile } from "@infraforge/domain/workload";

export function arrivalVersion(p: WorkloadProfile): "product-arrivals/1" | "product-arrivals/2" {
  const error = workloadDynamicsError(p.workloadDynamics); if (error) throw Error(error);
  return p.workloadDynamics?.arrivalProcess === "poisson" ? "product-arrivals/2" : "product-arrivals/1";
}
