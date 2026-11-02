import { expect, test } from "bun:test";
import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { withRunLength } from "../src/model2/product/runContract";
import { createProductModel2 } from "../src/model2/product/run";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { quantities } from "./workloadFixture";

export function recoveryDesign(retry: boolean, limited = false): SavedProductDesign {
  const resources: Resource[] = [
    { id: "lb", type: "Load Balancer", x: 0, y: 0, ...(limited ? { lbRateLimit: { version: 1 as const, burstRequests: 20, sustainedRequestsPerSecond: 200 } } : {}) },
    { id: "app", type: "Virtual Machine", x: 1, y: 0, vmExecution: { version: 1, workers: 1, queuedRequests: 0 } },
    { id: "db", type: "Database", x: 2, y: 0 },
  ];
  return { schema: "infraforge-saved-design/1", resources,
    connections: [["lb", "app"], ["app", "db"]].map(([sourceId, targetId], i) => ({ id: `edge-${i}`, sourceId: sourceId!, targetId: targetId!, sourceType: resources.find(r => r.id === sourceId)!.type, targetType: resources.find(r => r.id === targetId)!.type, port: RESOURCE_PORTS[resources.find(r => r.id === targetId)!.type] })),
    workload: { targetThroughput: 72000, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light", ...(retry ? { clientRetry: { version: 1, maxAttempts: 3, backoffMs: 50 } } : {}) } };
}

function measure(retry: boolean, limited = false) {
  const design = recoveryDesign(retry, limited), built = contractFromDesign(design);
  if ("refused" in built) throw Error(JSON.stringify(built));
  const contract = withRunLength(built.contract, 3, "recovery-amplification");
  contract.limits.maxPendingEvents = 10000; contract.limits.maxLiveCalls = 10000;
  const { q, ledger } = quantities();
  contract.arrival.changes = [{ at: q("stop-load", 1000000, "us"), fraction: q("zero-load", 0, "ratio") }]; contract.ledger.push(...ledger);
  const compiled = compileProduct(design, contract); if (!compiled.ok) throw Error(JSON.stringify(compiled));
  let issued = 0, scheduled = 0, exhausted = 0, recovered = 0;
  const originals: string[] = [];
  const stopped = new Map<string, number>(), retriedAfterStop: string[] = [];
  const runtime = createProductModel2(compiled.value, undefined, e => {
    if (e.kind === "caller-offered") originals.push(e.work!.rootId);
    if (e.kind === "client-attempt-issued") { issued++; if (stopped.has(e.work!.rootId)) retriedAfterStop.push(e.work!.rootId); }
    if (e.kind === "client-retry-scheduled") scheduled++;
    if (e.kind === "client-retry-stopped" && e.detail.reason === "exhausted") exhausted++;
    if (e.kind === "client-retry-stopped" && e.detail.rootReason === "rate-limited") stopped.set(e.work!.rootId, e.atUs);
    if (e.kind === "caller-terminal" && e.work!.attempt > 0 && e.detail.outcome === "completed") recovered++;
  });
  runtime.advanceTo(3000000);
  return { evidence: runtime.evidence(), originals, issued, scheduled, exhausted, recovered, stopped, retriedAfterStop, compiled: compiled.value };
}

test("same originals amplify real LB and application load with bounded attempts and exhausted roots", () => {
  const off = measure(false), on = measure(true);
  expect(on.originals).toEqual(off.originals);
  expect(on.evidence.counts.offered).toBe(off.evidence.counts.offered);
  expect(on.issued).toBeGreaterThan(on.originals.length);
  expect(on.evidence.network.loadBalancers[0]!.received - off.evidence.network.loadBalancers[0]!.received).toBe(on.issued - on.originals.length);
  expect(on.evidence.resources.find(r => r.id === "app")!.received - off.evidence.resources.find(r => r.id === "app")!.received).toBe(on.issued - on.originals.length);
  expect(on.exhausted).toBeGreaterThan(0);
  expect(on.issued).toBeLessThanOrEqual(on.originals.length * 3);
  expect(on.evidence.execution).toHaveProperty("clientAttempts", { issued: on.issued, limit: on.compiled.input.limits.maxRequests * 3 });
  expect(on.evidence.execution.processed).toBeLessThanOrEqual(on.compiled.input.limits.maxEvents);
  expect(on.evidence.execution.peakPending).toBeLessThanOrEqual(on.compiled.input.limits.maxPendingEvents!);
  console.info("recovery-amplification", JSON.stringify({ originals: on.originals.length, offLb: off.evidence.network.loadBalancers[0]!.received, onLb: on.evidence.network.loadBalancers[0]!.received, attempts: on.issued, retries: on.issued - on.originals.length, exhausted: on.exhausted, recovered: on.recovered, offCompleted: off.evidence.counts.completed, onCompleted: on.evidence.counts.completed, offDb: off.evidence.resources.find(r => r.id === "db")!.received, onDb: on.evidence.resources.find(r => r.id === "db")!.received }));
});

test("retries re-enter the LB bucket and rate-limited roots are never retried", () => {
  const on = measure(true, true), lb = on.evidence.network.loadBalancers[0]!, bucket = lb.rateLimit!;
  expect(bucket.received).toBe(on.issued);
  expect(bucket.admitted + bucket.rejected).toBe(lb.received);
  expect(bucket.rejected).toBeGreaterThan(0);
  expect(on.issued).toBeGreaterThan(on.originals.length);
  expect(on.issued).toBeLessThanOrEqual(on.originals.length * 3);
  expect(bucket.admitted).toBeLessThanOrEqual(20 + 200 * 3);
  expect(on.stopped.size).toBe(bucket.rejected); expect(on.retriedAfterStop).toEqual([]);
  console.info("recovery-limited", JSON.stringify({ originals: on.originals.length, attempts: on.issued, received: lb.received, admitted: bucket.admitted, rejected: bucket.rejected, exhausted: on.exhausted, recovered: on.recovered }));
});
