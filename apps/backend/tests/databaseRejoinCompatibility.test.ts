import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import pins from "./databaseRejoinLegacy.pins.json";
import { CHALLENGE_VERSIONS } from "../challenges/definitions";
import { specHash, challengeSeed } from "../challenges/registry";
import { captureRunInputs } from "../deployments/runInputs";
import { recordedScenario } from "../challenges/scenario";
import { promotionRun, promotionInput } from "./databasePromotion.fixture";
import { buildContractFromRunInputs, compileProduct } from "@infraforge/simulation/internal-product";

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v).replaceAll("\r\n", "\n")).digest("hex");
// Captured on untouched 8cdc20e5 before NX1 engine edits. Never regenerate to fix a failure.
test("all published identities and unmarked scenario plans retain their original bytes", () => {
  // Later labs add identities; every identity published at the base keeps its exact hash.
  const published = new Set(pins.identities.map((i: unknown[]) => `${i[0]}@${i[1]}`));
  expect(CHALLENGE_VERSIONS.filter(d => published.has(`${d.id}@${d.version}`)).map(d => [d.id, d.version, specHash(d)])).toEqual(pins.identities);
  const scenarios = new Set(pins.scenarios.map((s: string[]) => s[0]));
  expect(CHALLENGE_VERSIONS.filter(d => d.scenario && scenarios.has(d.id)).map(d => {
    const input = captureRunInputs(d.starter!, d.workload, challengeSeed(d));
    return [d.id, hash(recordedScenario(d, input))];
  })).toEqual(pins.scenarios);
});
test("omitted rejoin preserves compiled contracts and every legacy HA evidence/live tick", () => {
  for (const pin of pins.legacyRuns) {
    const input = promotionInput(pin.delay), built = buildContractFromRunInputs(input, 8);
    if ("refused" in built) throw Error(JSON.stringify(built));
    const compiled = compileProduct({schema: "infraforge-saved-design/1", resources: input.resources, connections: input.connectionLines, workload: input.workloadProfile}, built.contract);
    const run = promotionRun(pin.at, pin.delay, pin.outage as "primary" | "replica");
    expect({contract: hash(built), compiled: hash(compiled), ticks: hash(run.samples)}).toEqual({contract: pin.contract, compiled: pin.compiled, ticks: pin.ticks});
    for (const sample of run.samples) expect(sample.view.metrics.db!.databaseReplication).not.toHaveProperty("rejoin");
  }
});
