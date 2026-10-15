import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RESOURCE_TYPES } from "../../packages/domain/src/resource/RESOURCE_TYPES.constants";
import { validateLedger, type RealityEntry } from "../../packages/simulation/src/reality/ledger";

export const DEPTH_DIMENSIONS = ["configuration", "inputTraffic", "outputTraffic", "state", "capacity", "limits", "cpu", "memory", "network", "connections", "storageIO", "queuing", "scaling", "failureModes", "chaos", "recovery", "security", "cost", "dependencies", "observableMetrics"];
interface DepthRow { resource: string; dimensions: Record<string, string>; currentImplementation: string; realityGap: string; targetBehavior: string }
export function validateDepth(rows: DepthRow[]): string[] {
  const errors: string[] = [], expected = Object.values(RESOURCE_TYPES);
  if (rows.length !== expected.length || new Set(rows.map((r) => r.resource)).size !== expected.length) errors.push("Resource coverage incomplete");
  for (const type of expected) if (!rows.some((r) => r.resource === type)) errors.push(`Missing resource: ${type}`);
  for (const row of rows) {
    if (Object.keys(row.dimensions).sort().join() !== [...DEPTH_DIMENSIONS].sort().join()) errors.push(`${row.resource}: dimension coverage incomplete`);
    if (Object.values(row.dimensions).some((v) => !["partial", "generic", "synthetic", "absent", "not-applicable", "static", "approximation"].includes(v))) errors.push("Unknown depth level");
    if (![row.currentImplementation, row.realityGap, row.targetBehavior].every((v) => v.trim())) errors.push("Missing current/gap/target behavior");
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
  return [...validateLedger(facts), ...validateDepth(matrix.resources), ...validateLedger([...m2b.ledger, ...m2b.policyLedger]), ...validateLedger([...m2c.ledger, ...m2c.policyLedger]), ...validateLedger([...m2d.ledger, ...m2d.policyLedger]), ...validateLedger([...m2e.ledger, ...m2e.policyLedger]), ...validateLedger([...m2f.ledger, ...m2f.policyLedger])];
}
