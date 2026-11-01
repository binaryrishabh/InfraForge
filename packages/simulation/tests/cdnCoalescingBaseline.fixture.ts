import { cdnDesign, cdnSetup } from "./cdnTtl.fixture";
import { prepare } from "./asyncCanvas.fixture";
import { withRunLength } from "../src/model2/product/runContract";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { quantities } from "./workloadFixture";

export const baselineModes = ["storage", "repeated", "dns", "explicit-ttl", "concurrent-misses"] as const;
export function coalescingBaseline(mode: typeof baselineModes[number]) {
  if (mode !== "concurrent-misses") return cdnSetup(mode === "explicit-ttl" ? "repeated" : mode, mode === "explicit-ttl" ? 1 : undefined);
  const saved = cdnDesign(); saved.workload.targetThroughput = 60000;
  const adapted = prepare(saved), contract = withRunLength(adapted.contract, 1, "cdn-coalescing-baseline");
  const origin = contract.nodes.store!.resources[0]!.config, q = quantities();
  if (origin.kind !== "object-store") throw Error("Expected origin");
  origin.demands.get!.wait = q.q("baseline.origin.wait", 300000, "us"); contract.ledger.push(...q.ledger);
  const result = compileProduct(saved, contract); if (!result.ok) throw Error(JSON.stringify(result));
  return { saved, contract, compiled: result.value, assumptions: adapted.assumptions, runtime: createProductModel2(result.value) };
}
