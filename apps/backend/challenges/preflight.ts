import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import type { ChallengeDefinition, ChallengePreflight, PreflightCheck } from "@infraforge/contracts/challenges";
import { runCostEstimation } from "../stages/costEstimation.stages";
import { appServersBehindBalancer, genericSized, list, type Topology } from "./criteria";

/* Advisory readiness for the challenge workspace. It uses the same gate code the
worker runs, and it never reveals what the run itself will measure, including the
security scan, which several challenges ask the learner to predict. */
export function preflight(definition: ChallengeDefinition, topology: Topology): ChallengePreflight {
  const readiness = validateDeploymentReadiness(topology.resources, topology.connectionLines);
  const monthly = runCostEstimation(topology.resources).details as { monthlyEstimate: number };
  const checks: PreflightCheck[] = definition.criteria.map((c) => {
    const base = { id: c.id, label: c.label };
    switch (c.kind) {
      case "deployment-checks":
        return { ...base, status: readiness.valid ? "ok" : "problem", detail: readiness.valid ? "The design passes validation." : readiness.errors[0] ?? "Validation failed." };
      case "min-app-servers": {
        const count = appServersBehindBalancer(topology);
        return { ...base, status: count >= c.count ? "ok" : "problem", detail: `${count} of ${c.count} app servers are behind a load balancer.` };
      }
      case "catalog-sizes": {
        const generic = genericSized(topology);
        return { ...base, status: generic.length ? "problem" : "ok", detail: generic.length ? `Choose a size for ${list(generic)}.` : "All sized from the catalog." };
      }
      case "monthly-budget":
        return { ...base, status: monthly.monthlyEstimate <= c.maxUsd ? "ok" : "problem", detail: `Currently $${monthly.monthlyEstimate.toFixed(2)} a month.` };
      case "security-clean":
        return { ...base, status: "during-run", detail: "Checked by the security scan when the attempt runs." };
      default:
        return { ...base, status: "during-run", detail: `Measured at simulated second ${definition.evaluationSeconds}.` };
    }
  });
  return { valid: readiness.valid, errors: readiness.errors, warnings: readiness.warnings,
    monthlyEstimateUsd: monthly.monthlyEstimate, checks, resourceTypes: [...new Set(topology.resources.map((r) => r.type))] };
}
