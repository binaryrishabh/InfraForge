import { expect, test } from "bun:test";
import { productFixture } from "./productFixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";

function drain(grace: number) {
  const f = productFixture(), p = f.contract.nodes.vm!.controller!;
  p.drain = f.q.q("proof.drain.grace", grace, "us");
  p.manual.push({ id: "down", at: f.q.q("proof.drain.at", 75000, "us"), desired: f.q.q("proof.drain.desired", 1, "count") });
  const c = compileProduct(f.design, f.contract); if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const runtime = createProductModel2(c.value); runtime.advanceTo(75000);
  const start = runtime.evidence(), backend = start.network.loadBalancers[0]!.backends.find(b => b.id === "vm#1")!;
  runtime.advanceTo(75000 + grace - 1); const beforeExpiry = runtime.evidence();
  runtime.advanceTo(110000); const end = runtime.evidence();
  return { grace, start, backend, beforeExpiry, end };
}

test("autoscaling drain excludes new requests, expires in-flight work and exposes forced closure", () => {
  const forced = drain(1), settled = drain(30000);
  for (const run of [forced, settled]) {
    expect(run.backend.draining).toBe(true); expect(run.backend.outstanding).toBeGreaterThan(0);
    expect(run.end.network.loadBalancers[0]!.backends.find(b => b.id === "vm#1")!.selected).toBe(run.backend.selected);
    expect(run.end.network.endpoints["vm#1"]).toEqual({ alive: false, ready: false });
  }
  const terminated = (r: typeof forced) => r.end.product.controllers[0]!.events.find(e => e.kind === "terminated" && e.id === "vm#1")!.at;
  expect(forced.beforeExpiry.product.controllers[0]!.replicas[1]!.state).toBe("draining");
  expect(terminated(forced)).toBe(75001); expect(terminated(settled)).toBeLessThan(105000);
  const path = (r: typeof forced) => r.end.network.paths.find(p => p.source === "lb" && p.target === "vm#1")!;
  expect(path(forced).reasons.drained).toBeGreaterThan(0);
  expect(path(settled).reasons.drained ?? 0).toBe(0);
  expect(path(forced).pool.failedStreams).toBeGreaterThan(path(settled).pool.failedStreams);
  console.info("vm-drain", JSON.stringify({ forced: { outstanding: forced.backend.outstanding, terminated: terminated(forced), reasons: path(forced).reasons }, settled: { outstanding: settled.backend.outstanding, terminated: terminated(settled), reasons: path(settled).reasons } }));
});
