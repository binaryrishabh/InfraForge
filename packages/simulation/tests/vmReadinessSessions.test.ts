import { expect, test } from "bun:test";
import { productFixture } from "./productFixture";
import { dbPoolCascade } from "./dbPoolCascadeFixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { quantities } from "./workloadFixture";

test("registry failure postpones real replica readiness and its first LB selection", () => {
  const run = (registryOutage: boolean) => {
    const f = productFixture({ registryOutage });
    f.contract.arrival.peak!.end = f.q.q("proof.readiness.peakEnd", 180000, "us");
    const c = compileProduct(f.design, f.contract);
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const selected: number[] = [];
    const runtime = createProductModel2(c.value, undefined, e => { if (e.kind === "lb-selected" && e.detail.detail === "vm#1") selected.push(e.atUs); });
    runtime.advanceTo(80000); const mid = runtime.evidence();
    runtime.advanceTo(runtime.horizon); return { mid, end: runtime.evidence(), selected };
  };
  const normal = run(false), delayed = run(true);
  const readyAt = (r: typeof normal) => r.end.product.controllers[0]!.replicas[1]!.readyAt!;
  expect(delayed.mid.product.controllers[0]!.replicas[1]!.readyAt).toBeNull();
  expect(delayed.mid.network.loadBalancers[0]!.backends.find(b => b.id === "vm#1")!.selected).toBe(0);
  expect(delayed.mid.systems.clients.find(c => c.id === "vm#1/image")!.failures).toBeGreaterThan(0);
  expect(readyAt(delayed)).toBeGreaterThan(readyAt(normal));
  for (const r of [normal, delayed]) {
    expect(r.selected.length).toBeGreaterThan(0); expect(r.selected.every(at => at >= readyAt(r))).toBe(true);
    const acquired = r.end.product.controllers[0]!.events.find(e => e.kind === "artifacts-acquired" && e.id === "vm#1")!;
    expect(readyAt(r) - acquired.at).toBe(1000);
  }
  console.info("vm-readiness", JSON.stringify({ normalReady: readyAt(normal), delayedReady: readyAt(delayed), firstSelected: [normal.selected[0], delayed.selected[0]], failedPulls: delayed.mid.systems.clients.find(c => c.id === "vm#1/image")!.failures }));
});

test("increasing only the VM replica ceiling exceeds shared database sessions rather than creating DB capacity", () => {
  const base = dbPoolCascade();
  const run = (maximum: number) => {
    const design = structuredClone(base.design), contract = structuredClone(base.contract), q = quantities();
    design.resources.find(r => r.id === "app")!.autoscaling!.maxReplicas = maximum;
    contract.nodes.app!.controller!.max = q.q("proof.replica.maximum", maximum, "count"); contract.ledger.push(...q.ledger);
    const c = compileProduct(design, contract); if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const runtime = createProductModel2(c.value); runtime.advanceTo(24000000);
    return runtime.evidence();
  };
  const one = run(1), three = run(3), a = one.data.databases[0]!, b = three.data.databases[0]!;
  expect(one.counts.offered).toBe(three.counts.offered);
  expect(one.product.controllers[0]!.replicas.filter(r => r.state === "ready")).toHaveLength(1);
  expect(three.product.controllers[0]!.replicas.filter(r => r.state === "ready")).toHaveLength(3);
  expect(a.sessions.limit).toBe(12); expect(b.sessions.limit).toBe(a.sessions.limit);
  expect(a.sessionEvents!.refused).toBe(0); expect(b.sessionEvents!.refused).toBeGreaterThan(0);
  expect(a.sessions.total).toBeLessThanOrEqual(10); expect(b.sessions.total).toBe(12);
  for (const e of [one, three]) for (const path of e.network.paths.filter(p => p.target === "db")) expect(path.pool.connections).toBeLessThanOrEqual(10);
  console.info("vm-replicas-db-sessions", JSON.stringify({ roots: one.counts.offered, one: { sessions: a.sessions, refused: a.sessionEvents!.refused }, three: { sessions: b.sessions, refused: b.sessionEvents!.refused } }));
});
