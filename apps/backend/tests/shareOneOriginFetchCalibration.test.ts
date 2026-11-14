import { expect, test } from "bun:test";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { challengeSeed } from "../challenges/registry";
import { recordedScenario } from "../challenges/scenario";
import { preflight } from "../challenges/preflight";
import { buildRunReport } from "../reports/report";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

const ID = "share-one-origin-fetch", d = definition(ID), START = d.starter!, REF = REFERENCE[ID]!;
const edit = (base: ChallengeStarter, change: (s: ChallengeStarter) => void) => { const s = structuredClone(base); change(s); return s; };
const resource = (s: ChallengeStarter, id: string) => s.resources.find(r => r.id === id)!;
const ttl = (seconds: number) => (s: ChallengeStarter) => { resource(s, "cdn").cdnCachePolicy!.ttlSeconds = seconds; };
const near = edit(START, ttl(2));

function seeded(design: ChallengeStarter, seed: string) {
  const input = captureRunInputs({ ...design, layoutVersion: 3 }, d.workload, seed), engine = createModel2Engine(input, d.evaluationSeconds), plan = recordedScenario(d, input)!;
  let constrainedLink;
  for (let second = 1; second <= d.evaluationSeconds; second++) {
    engine.advance();
    for (const step of plan.steps.filter(s => s.atSecond === second)) {
      engine.apply({ kind: "intervention", parameters: step.request });
      while (engine.catchingUp) engine.catchUp(10);
    }
    if (second === 10) constrainedLink = engine.evidence().network.links.find(l => l.from === "store" && l.to === "cdn");
  }
  const view = engine.view(), traffic = view.traffic.wholeRun!, cdn = view.metrics.cdn!.cdn!;
  return { completed: traffic.completed, failed: traffic.failed + traffic.deadlineExceeded + traffic.abandoned, origin: cdn.originRequests!, fills: cdn.fills!, coalesced: cdn.coalesced!, p95: traffic.percentiles.p95, constrainedLink };
}

test("share-one-origin-fetch: worst of six Poisson seeds has comfortable margins and real caller loss remains", () => {
  const table = [challengeSeed(d), "seed-a", "seed-b", "seed-c", "seed-d", "seed-e"].map(seed => ({ seed, starter: seeded(START, seed), reference: seeded(REF, seed), near: seeded(near, seed) }));
  for (const row of table) {
    expect(row.starter.failed).toBeGreaterThanOrEqual(130);
    expect(row.reference.failed).toBeGreaterThan(0);
    expect(row.reference.failed).toBeLessThanOrEqual(4);
    expect(row.reference.completed - 10500).toBeGreaterThanOrEqual(1390);
    expect(45 - row.reference.origin).toBeGreaterThanOrEqual(18);
    expect(row.near.failed - 50).toBeGreaterThanOrEqual(30);
    expect(row.near.origin).toBeGreaterThan(150);
    for (const run of [row.starter, row.reference, row.near]) expect(run.constrainedLink!.bandwidthBytesPerSecond).toBe(2000000);
    expect(row.starter.constrainedLink!.failedBytes).toBeGreaterThan(row.reference.constrainedLink!.failedBytes);
    expect(row.starter.constrainedLink!.startedQueueWaitUs).toBeGreaterThan(row.reference.constrainedLink!.startedQueueWaitUs);
  }
  expect(new Set(table.map(row => row.reference.completed)).size).toBeGreaterThan(3);
  console.info("share-origin-six-seeds", JSON.stringify(table));
}, 300000);

// All but the legacy-policy compatibility case use exposed TTL, capacity or shared-fill controls.
const SWEEP: Array<[string, ChallengeStarter]> = [];
for (const n of [2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 60, 300, 3600]) SWEEP.push([`ttl-${n}`, edit(START, ttl(n))]);
for (const n of [1, 2, 4, 8, 16, 32, 64, 128, 256, 1024]) SWEEP.push([`store-capacity-${n}`, edit(START, s => { resource(s, "store").objectStoragePolicy = { version: 1, capacityMiB: n }; })]);
for (const n of [1, 2, 4, 8, 12, 15, 16, 32, 64, 128, 256, 1024, 100000]) SWEEP.push([`shared-waiters-${n}`, edit(REF, s => { resource(s, "cdn").cdnCachePolicy = { version: 2, ttlSeconds: 1, coalesce: true, maxWaiters: n }; })]);
for (const n of [2, 5, 60]) SWEEP.push([`shared-ttl-${n}`, edit(REF, ttl(n))]);
SWEEP.push(["legacy-ttl-only", edit(START, s => { resource(s, "cdn").cdnCachePolicy = { version: 1, ttlSeconds: 1 }; })]);
SWEEP.push(["shared-unset-ttl", edit(REF, s => { resource(s, "cdn").cdnCachePolicy = { version: 2, coalesce: true }; })]);
SWEEP.push(["shared-small-store", edit(REF, s => { resource(s, "store").objectStoragePolicy = { version: 1, capacityMiB: 1 }; })]);
const PASS = new Set(["shared-waiters-16", "shared-waiters-32", "shared-waiters-64", "shared-waiters-128", "shared-waiters-256", "shared-waiters-1024", "shared-waiters-100000", "legacy-ttl-only", "shared-small-store"]);

test("share-one-origin-fetch: sweep has at least forty distinct plausible edits", () => {
  expect(SWEEP.length).toBeGreaterThanOrEqual(40);
  expect(new Set(SWEEP.map(([, s]) => JSON.stringify(s))).size).toBe(SWEEP.length);
});
for (const [name, design] of SWEEP) test(`share-one-origin-fetch sweep: ${name}`, () => {
  expect(preflight(d, design).errors).toEqual([]);
  const report = buildRunReport(attemptRow(d, design, answers(d, { health: "healthy" }))), traffic = report.terminal!.traffic!.wholeRun!, cdn = report.terminal!.resources.find(r => r.id === "cdn")!.cdn!;
  console.info("share-origin-edit", JSON.stringify({ name, status: report.challenge!.status, criteria: report.challenge!.criteria.map(c => [c.id, c.status]), completed: traffic.completed, failed: traffic.failed, origin: cdn.originRequests, coalesced: cdn.coalesced, p95: traffic.percentiles.p95 }));
  expect(report.challenge!.status).toBe(name === "shared-unset-ttl" ? "not-evaluated" : PASS.has(name) ? "met" : "not-met");
  if (name === "ttl-60") expect(traffic.failed).toBeLessThanOrEqual(50); // a caller fix still violates the stated TTL bound
}, 120000);
