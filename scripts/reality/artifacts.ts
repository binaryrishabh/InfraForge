import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { RESOURCE_TYPES } from "../../packages/domain/src/resource/RESOURCE_TYPES.constants";
import { validateLedger, type RealityEntry } from "../../packages/simulation/src/reality/ledger";

import { validateProductArtifacts } from "./product-artifacts";

export const DEPTH_DIMENSIONS = ["configuration", "inputTraffic", "outputTraffic", "state", "capacity", "limits", "cpu", "memory", "network", "connections", "storageIO", "queuing", "scaling", "failureModes", "chaos", "recovery", "security", "cost", "dependencies", "observableMetrics"];
interface DepthRow { productBridge?: { revision: string; level: string; owner: string; compiler: string; proof: string; evidence: string; shippingEligible: boolean }; resource: string; dimensions: Record<string, string>; currentImplementation: string; realityGap: string; targetBehavior: string; model2?: { revision: string; foundation: string; dimensions: Record<string, string>; implemented: string[]; partial: string[]; unknown: string[]; remainingGap: string; mechanismOwners: string[]; proofs: string[]; shippingGate: string } }
export function validateDepth(rows: DepthRow[], root?: string): string[] {
  const errors: string[] = [], expected = Object.values(RESOURCE_TYPES);
  if (rows.length !== expected.length || new Set(rows.map((r) => r.resource)).size !== expected.length) errors.push("Resource coverage incomplete");
  for (const type of expected) if (!rows.some((r) => r.resource === type)) errors.push(`Missing resource: ${type}`);
  for (const row of rows) {
    if (Object.keys(row.dimensions).sort().join() !== [...DEPTH_DIMENSIONS].sort().join()) errors.push(`${row.resource}: dimension coverage incomplete`);
    if (Object.values(row.dimensions).some((v) => !["partial", "generic", "synthetic", "absent", "not-applicable", "static", "approximation"].includes(v))) errors.push("Unknown depth level");
    if (![row.currentImplementation, row.realityGap, row.targetBehavior].every((v) => v.trim())) errors.push("Missing current/gap/target behavior");
    const b = row.productBridge; if (!b || b.revision !== "m2h/1" || b.level !== "product-semantic-bridge-proven" || b.shippingEligible !== false || (root && [b.owner, b.compiler, b.proof, b.evidence].some((p) => !existsSync(resolve(root, p))))) errors.push(`${row.resource}: incomplete M2H bridge owner/proof/gap`);
    const m = row.model2;
    if (!m || m.revision !== "m2g/1" || !m.foundation || !m.implemented.length || !m.partial.length || !m.unknown.length || !m.remainingGap || !m.mechanismOwners.length || !m.proofs.length || m.shippingGate !== "CLOSED: see shipping-reality.json" || Object.keys(m.dimensions).sort().join() !== [...DEPTH_DIMENSIONS].sort().join() || Object.values(m.dimensions).some((v) => !["implemented", "partial", "Unknown", "not-applicable"].includes(v))) errors.push(`${row.resource}: incomplete Model-2 depth/gap coverage`);
    if (root && m && [...m.mechanismOwners, ...m.proofs].some((p) => !existsSync(resolve(root, p)))) errors.push(`${row.resource}: missing mechanism/proof source`);
  }
  return errors;
}
export function validateArtifacts(root: string): string[] {
  const facts = JSON.parse(readFileSync(resolve(root, "docs/reality/provider-facts.json"), "utf8")) as RealityEntry[];
  const matrix = JSON.parse(readFileSync(resolve(root, "docs/reality/resource-depth.json"), "utf8")) as { resources: DepthRow[] };
  const m2b = JSON.parse(readFileSync(resolve(root, "docs/reality/m2b-calibration.json"), "utf8")) as { ledger: RealityEntry[]; policyLedger: RealityEntry[] };
  const m2c = JSON.parse(readFileSync(resolve(root, "docs/reality/m2c-calibration.json"), "utf8")) as { ledger: RealityEntry[]; policyLedger: RealityEntry[] };
  const m2d = JSON.parse(readFileSync(resolve(root, "docs/reality/m2d-calibration.json"), "utf8")) as { ledger: RealityEntry[]; policyLedger: RealityEntry[] };
  const m2e = JSON.parse(readFileSync(resolve(root, "docs/reality/m2e-calibration.json"), "utf8")) as { ledger: RealityEntry[]; policyLedger: RealityEntry[] };
  const m2f = JSON.parse(readFileSync(resolve(root, "docs/reality/m2f-calibration.json"), "utf8")) as { ledger: RealityEntry[]; policyLedger: RealityEntry[] };
  const m2g = JSON.parse(readFileSync(resolve(root, "docs/reality/m2g-calibration.json"), "utf8")) as { ledger: RealityEntry[]; policyLedger: RealityEntry[] };
  const m2h = JSON.parse(readFileSync(resolve(root, "docs/reality/m2h-ledger.json"), "utf8")) as { ledger: RealityEntry[]; policyLedger: RealityEntry[] };
  return [...validateLedger([...m2h.ledger, ...m2h.policyLedger]), ...validateProductArtifacts(root), ...validateLedger(facts), ...validateDepth(matrix.resources, root), ...validateLedger([...m2b.ledger, ...m2b.policyLedger]), ...validateLedger([...m2c.ledger, ...m2c.policyLedger]), ...validateLedger([...m2d.ledger, ...m2d.policyLedger]), ...validateLedger([...m2e.ledger, ...m2e.policyLedger]), ...validateLedger([...m2f.ledger, ...m2f.policyLedger]), ...validateLedger([...m2g.ledger, ...m2g.policyLedger])];
}
