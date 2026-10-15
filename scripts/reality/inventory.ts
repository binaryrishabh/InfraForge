import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { scanRepository } from "./scan";
import { AUDIT_SHA, classify } from "./classify";
import { validateLedger } from "../../packages/simulation/src/reality/ledger";
import { validateArtifacts } from "./artifacts";

export const root = resolve(import.meta.dir, "../..");
export function buildInventory() {
  const files = scanRepository(root);
  const ledger = files.flatMap((f) => f.sites.map((s) => ({ ...classify(s), location: { file: s.file, line: s.line, column: s.column } })));
  const errors = validateLedger(ledger); if (errors.length) throw new Error(errors.join("\n"));
  return { schemaVersion: 1, modelVersion: "1", auditedSha: AUDIT_SHA, researchedOn: "2026-10-15",
    coverage: "All numeric AST literals in application and package production TypeScript; includes nonphysical policies. Tests/generated code/SQL/tooling/CSS excluded with rationale in audit.md. No runtime imports.",
    files: files.map(({ file, sha256, sites }) => ({ file, sha256, numericSites: sites.length })), ledger };
}
if (import.meta.main) {
  const errors = validateArtifacts(root); if (errors.length) throw new Error(errors.join("\n"));
  const inventory = buildInventory(), path = resolve(root, "docs/reality/model1-ledger.json");
  const text = JSON.stringify(inventory, null, 2) + "\n";
  if (process.argv.includes("--write")) writeFileSync(path, text);
  else if (readFileSync(path, "utf8").replaceAll("\r\n", "\n") !== text) throw new Error("Reality inventory drift: inspect changed sources and regenerate deliberately");
  console.info(JSON.stringify({ files: inventory.files.length, numericSites: inventory.ledger.length,
    classifications: Object.fromEntries([...new Set(inventory.ledger.map((e) => e.classification))].map((c) => [c, inventory.ledger.filter((e) => e.classification === c).length])) }));
}
