import { expect, test } from "bun:test";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { definition } from "./challengeHarness";

// Invariants of artifact-cache/1 (per-client byte admission for later replicas) and autoscaling-observed/1 (scale only on delivered, fresh samples).
const find = (o: any, k: string, acc: any[] = []) => { if (o && typeof o === "object") { if (k in o) acc.push(o); for (const v of Object.values(o)) find(v, k, acc); } return acc; };
function run(def: ReturnType<typeof definition>, design: ChallengeStarter, seconds: number) {
  const engine = createModel2Engine(captureRunInputs(design, def.workload, "startup-invariants"), seconds), history: Array<{ inService: number; desired: number }> = [];
  for (let s = 1; s <= seconds; s++) { engine.advance(); const c = find(engine.evidence(), "missingMeasurements")[0]; history.push({ inService: c.inService, desired: c.desired }); }
  const ev = engine.evidence();
  return { history, controller: find(ev, "missingMeasurements")[0], clients: find(ev, "pulledBytes").filter(c => "cachedBytes" in c && "failures" in c), digest: JSON.stringify(ev) };
}

const image = definition("admit-a-replica-image");
const withCapacity = (capacityBytes: number | undefined, maxReplicas = 2) => {
  const s = structuredClone(image.starter!), app = s.resources.find(r => r.id === "app")!;
  app.autoscaling!.maxReplicas = maxReplicas;
  if (capacityBytes === undefined) delete app.artifactCachePolicy; else app.artifactCachePolicy = { version: 1, capacityBytes };
  return s;
};
const LAYER = 1024;

test("artifact capacity: an initial replica never needs a pull, and a layer is admitted exactly when it fits", () => {
  for (const [capacity, admitted] of [[1, false], [LAYER - 1, false], [LAYER, true], [LAYER + 1, true]] as const) {
    const r = run(image, withCapacity(capacity), 20), initial = r.clients.find(c => c.id === "app#0/image"), later = r.clients.find(c => c.id === "app#1/image");
    expect(initial).toMatchObject({ pulledBytes: 0, cachedBytes: 0 });
    expect(r.history.at(-1)!.inService).toBe(admitted ? 2 : 1);
    expect(later!.cachedBytes).toBeLessThanOrEqual(capacity);
    if (!admitted) { expect(later!.pulledBytes).toBe(0); expect(later!.failures).toBeGreaterThan(0); }
  }
});

test("a capacity failure is never ready at any second, and more replicas or retries cannot make the layer fit", () => {
  const r = run(image, withCapacity(LAYER - 1, 4), 30);
  for (const h of r.history) expect(h.inService).toBe(1);
  for (const c of r.clients.filter(c => c.id !== "app#0/image")) expect(c).toMatchObject({ pulledBytes: 0, cachedBytes: 0 });
});

test("every replica owns its client bytes: nothing is shared between replicas", () => {
  const r = run(image, withCapacity(LAYER, 3), 40), later = r.clients.filter(c => c.id !== "app#0/image" && c.pulledBytes > 0);
  expect(later.length).toBeGreaterThanOrEqual(1);
  for (const c of later) expect(c.pulledBytes).toBe(LAYER);
  expect(r.clients.reduce((n, c) => n + c.pulledBytes, 0)).toBe(later.length * LAYER);
});

test("an unset capacity keeps the historical profile: a later replica starts", () => {
  expect(run(image, withCapacity(undefined), 20).history.at(-1)!.inService).toBe(2);
});

const scale = definition("scale-on-delivered-samples");
const signalDesign = (over: { fresh?: number; collect?: number; exportEvery?: number; signal?: boolean } = {}) => {
  const s = structuredClone(scale.starter!), app = s.resources.find(r => r.id === "app")!, mon = s.resources.find(r => r.id === "monitor")!;
  if (over.signal === false) delete app.autoscaling!.signal; else if (over.fresh !== undefined) app.autoscaling!.signal!.freshForSeconds = over.fresh;
  mon.monitoringPolicy = { ...mon.monitoringPolicy!, ...(over.collect ? { collectionIntervalSeconds: over.collect } : {}), ...(over.exportEvery ? { exportIntervalSeconds: over.exportEvery } : {}) } as typeof mon.monitoringPolicy;
  return s;
};

test("signal: undelivered samples hold the pool even though the server is busy, and every evaluation is counted as missing", () => {
  const r = run(scale, signalDesign(), 90);
  expect(r.controller.desired).toBe(1); expect(r.controller.inService).toBe(1);
  expect(r.controller.evaluations).toBeGreaterThan(0); expect(r.controller.missingMeasurements).toBe(r.controller.evaluations);
});

test("signal: samples older than the freshness bound are never used; a bound under the collection spacing can never form a pair", () => {
  const tight = run(scale, signalDesign({ fresh: 1, collect: 2, exportEvery: 2 }), 60);
  expect(tight.controller.missingMeasurements).toBe(tight.controller.evaluations); expect(tight.controller.desired).toBe(1);
  const wide = run(scale, signalDesign({ fresh: 8, collect: 2, exportEvery: 2 }), 60);
  expect(wide.controller.missingMeasurements).toBeLessThan(wide.controller.evaluations); expect(wide.controller.desired).toBeGreaterThan(1);
});

test("signal: the largest freshness bound (60 s) compiles and runs; the direct signal is unchanged without a saved selection", () => {
  expect(run(scale, signalDesign({ fresh: 60 }), 30).controller.evaluations).toBeGreaterThan(0);
  const direct = run(scale, signalDesign({ signal: false }), 60);
  expect(direct.controller.desired).toBeGreaterThan(1); // direct truth scales; the saved delivered-sample choice is what held the pool
});

test("both capabilities replay to byte-identical evidence", () => {
  expect(run(image, withCapacity(LAYER), 20).digest).toBe(run(image, withCapacity(LAYER), 20).digest);
  expect(run(scale, signalDesign({ fresh: 8, exportEvery: 2 }), 40).digest).toBe(run(scale, signalDesign({ fresh: 8, exportEvery: 2 }), 40).digest);
});
