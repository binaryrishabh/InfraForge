import type { AdapterProfile } from "@infraforge/contracts/run-inputs";
import type { Resource, ConnectionLine } from "@infraforge/domain/resource";
import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import { resolveWorkload, type WorkloadProfile } from "@infraforge/domain/workload";
import { contractFromDesign } from "./fromDesign";

// Drawing/structure belongs to domain; execution eligibility belongs to Model 2.
// Captured runs pass their exact profiles (including []); an editing canvas uses current profiles.
export function validateModel2Readiness(resources: Resource[], connections: ConnectionLine[], context?: {
  workload?: WorkloadProfile;
  adapterProfiles?: readonly AdapterProfile[];
}) {
  const structure = validateDeploymentReadiness(resources, connections);
  const built = contractFromDesign({ schema: "infraforge-saved-design/1", resources, connections, workload: resolveWorkload(context?.workload) },
    context?.adapterProfiles === undefined ? undefined : { adapterProfiles: context.adapterProfiles });
  const errors = [...new Set([...structure.errors, ...("refused" in built ? built.refused.map(d => d.message) : [])])];
  return { valid: errors.length === 0, errors, warnings: structure.warnings };
}
