import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { CHALLENGE_VERSIONS } from "../challenges/definitions";
import { captureRunInputs } from "../deployments/runInputs";
import { contractFromDesign, compileProduct, createLiveModel2, withRunLength } from "@infraforge/simulation/internal-product";
import pins from "./dbPoolCompatibility.pins.json";
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v).replaceAll("\r\n", "\n")).digest("hex");
// Captured on untouched 56eb921. One-second execution without scenario actions.
// Compilation and execution bytes; full scenario calibrations are separate.
for (const pin of pins) test(`unset pool preserves published input/contract/compiled/assumptions/evidence/live: ${pin.id}@${pin.version}`, () => {
 const d = CHALLENGE_VERSIONS.find(d => d.id === pin.id && d.version === pin.version)!;
 const s = structuredClone(d.starter!); for (const r of s.resources) r.dbPoolMaxConnections = undefined;
 const input = captureRunInputs(s, d.workload, `challenge:${d.id}:v${d.version}`);
 const design = {schema: "infraforge-saved-design/1" as const, resources: input.resources, connections: input.connectionLines, workload: input.workloadProfile};
 const b = contractFromDesign(design, {adapterProfiles: input.adapterProfiles}); if ("refused" in b) throw Error(JSON.stringify(b.refused));
 const contract = withRunLength(b.contract, 1, input.seed), c = compileProduct(design, contract); if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
 const live = createLiveModel2(c.value, input.resources.map(r => r.id)); live.advanceSecond();
 expect([hash(input), hash(contract), hash(c.value), hash(b.assumptions), hash(live.evidence()), hash(live.project())]).toEqual(pin.hashes);
}, 30000);
