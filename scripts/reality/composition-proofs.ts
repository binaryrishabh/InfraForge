import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { workloadFixture } from "../../packages/simulation/tests/workloadFixture";
import { computeFixture } from "../../packages/simulation/tests/computeFixture";
import { networkFixture, verticalFixture } from "../../packages/simulation/tests/networkFixture";
import { dataFixture } from "../../packages/simulation/tests/dataFixture";
import { asyncFixture } from "../../packages/simulation/tests/asyncFixture";
import { systemsFixture } from "../../packages/simulation/tests/systemsFixture";
import { productFixture } from "../../packages/simulation/tests/productFixture";
import { createWorkloadModel2 } from "../../packages/simulation/src/model2/workload/run";
import { createComputeModel2 } from "../../packages/simulation/src/model2/compute/run";
import { createNetworkModel2 } from "../../packages/simulation/src/model2/network/run";
import { createDataModel2 } from "../../packages/simulation/src/model2/data/run";
import { createAsyncModel2 } from "../../packages/simulation/src/model2/async/run";
import { createSystemsModel2 } from "../../packages/simulation/src/model2/systems/run";
import { compileProduct } from "../../packages/simulation/src/model2/product/compiler";
import { createProductModel2 } from "../../packages/simulation/src/model2/product/run";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value).replaceAll("\r\n", "\n")).digest("hex");
export function compositionProofs() {
  const f = productFixture({ horizon: 100000 }), compiled = compileProduct(f.design, f.contract);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const runtimes = [
    ["m2b/1", createWorkloadModel2(workloadFixture())],
    ["m2c/1", createComputeModel2(computeFixture())],
    ["m2d/1", createNetworkModel2(networkFixture())],
    ["m2d/1-lb", createNetworkModel2(verticalFixture())],
    ["m2e/1", createDataModel2(dataFixture())],
    ["m2f/1", createAsyncModel2(asyncFixture())],
    ["m2g/1", createSystemsModel2(systemsFixture())],
    ["m2h/1", createProductModel2(compiled.value)],
  ] as const;
  return runtimes.map(([composition, runtime]) => {
    runtime.advanceTo(runtime.horizon);
    return { composition, evidenceSha256: hash(runtime.evidence()) };
  });
}
if (import.meta.main) {
  const path = new URL("../../docs/reality/stage1-composition-hashes.json", import.meta.url);
  const actual = compositionProofs();
  if (process.argv.includes("--write-baseline")) writeFileSync(path, JSON.stringify(actual, null, 2) + "\n");
  else if (JSON.stringify(actual) !== JSON.stringify(JSON.parse(readFileSync(path, "utf8")))) throw Error("Pinned composition evidence changed");
  console.info(JSON.stringify({ compositions: actual.length, hashes: actual }));
}

