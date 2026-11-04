import { expect, test } from "bun:test";
import { prepare } from "./asyncCanvas.fixture";
import { gatewayDesign } from "./apiGateway.fixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { withRunLength } from "../src/model2/product/runContract";
import { createProductModel2 } from "../src/model2/product/run";
function run(burst: number) {
  const d = gatewayDesign(burst), f = prepare(d), c = compileProduct(d, withRunLength(f.contract, 2, "gateway-proof")); if (!c.ok) throw Error(JSON.stringify(c));
  const runtime = createProductModel2(c.value); runtime.advanceTo(2_000_000); return runtime.evidence();
}
test("saved route budgets cause real independent downstream admission under the same workload and seed", () => {
  const small = run(1), large = run(100), a = small.asynchronous.gateways![0]!, b = large.asynchronous.gateways![0]!;
  expect(a.throttled).toBe(8); expect(b.throttled).toBe(0);
  expect(a.completed).toBe(12); expect(b.completed).toBe(20);
  expect(a.routes[0]!.admitted).toBe(2); expect(a.routes[1]!.admitted).toBe(10);
  expect(small.resources.find(r => r.id === "readApp")!.completed).toBe(2);
  expect(small.resources.find(r => r.id === "writeApp")!.completed).toBe(10);
  expect(large.resources.find(r => r.id === "readApp")!.completed).toBe(10);
});
test("gateway request validation includes the same envelope bytes carried by the real network", () => {
  const d = gatewayDesign(100); d.resources[0]!.apiGateway!.maxRequestBytes = 1023;
  const f = prepare(d), c = compileProduct(d, withRunLength(f.contract, 2, "gateway-proof")); if (!c.ok) throw Error(JSON.stringify(c));
  const runtime = createProductModel2(c.value); runtime.advanceTo(2_000_000);
  expect(runtime.evidence().asynchronous.gateways![0]!).toMatchObject({ invalid: 20, admitted: 0, completed: 0 });
  expect(runtime.evidence().resources.find(r => r.id === "readApp")!.received).toBe(0);
});
test("captured gateway intent and route targets/budgets cannot be silently upgraded or tampered", () => {
  const d = gatewayDesign(); expect(currentAdapterProfiles(d.resources)).toEqual(["api-gateway/1"]);
  for (const adapterProfiles of [[], ["api-gateway/1", "api-gateway/1"]] as const) expect(contractFromDesign(d, { adapterProfiles })).toHaveProperty("refused");
  const f = prepare(d), config = f.contract.nodes.gateway!.resources[0]!.config; if (config.kind !== "api-gateway") throw Error("gateway missing");
  config.routes[0]!.target = "$writeApp"; expect(compileProduct(d, f.contract).ok).toBe(false);
});
