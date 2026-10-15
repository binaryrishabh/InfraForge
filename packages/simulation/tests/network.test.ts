import { test, expect } from "bun:test";
import { createNetworkModel2 } from "../src/model2/network/run";
import { networkFixture, verticalFixture } from "./networkFixture";
import type { NetworkInput, LoadBalancer } from "../src/model2/network/contracts";
import { quantities } from "./workloadFixture";
import { keyedUniform } from "../src/model2/random";
import { resolveModel } from "../src/model2/registry";

export function networkRun(input: NetworkInput, batch?: number) { const m = createNetworkModel2(input); if (batch) for (let t = batch; t < m.horizon; t += batch) m.advanceTo(t); m.advanceTo(m.horizon); return m.evidence(); }
export function networkConservation(e: ReturnType<typeof networkRun>) {
  const c = e.counts; if (c.offered !== c.completed + c.rejected + c.deadlineExceeded + c.abandoned + c.inFlight) throw new Error("Caller conservation");
  for (const l of e.network.links) {
    const near = (a: number, b: number) => Math.abs(a - b) <= 1e-5;
    if (!near(l.offeredBytes, l.acceptedBytes + l.rejectedBytes) || !near(l.acceptedBytes, l.deliveredBytes + l.failedBytes + l.liveBytes) || !near(l.transmittedBytes, l.deliveredBytes + l.discardedTransmittedBytes + l.liveTransmittedBytes)) throw new Error(`Link byte conservation ${l.id}`);
    if (l.queuedBytes < 0 || l.serializingRemainingBytes < -1e-6) throw new Error("Negative byte population");
  }
  for (const p of e.network.paths) {
    if (p.offered !== p.completed + p.failed + p.cancelled + p.live) throw new Error("Path ownership");
    const pool = p.pool;
    if (pool.connections !== pool.connecting + pool.idle + pool.active + pool.drainingConnections || pool.created !== pool.closed + pool.connections || pool.activeStreams > pool.connections * 256) throw new Error("Pool connection conservation");
    if (pool.acquired !== pool.released + pool.failedStreams + pool.activeStreams) throw new Error("Pool stream conservation");
  }
  for (const lb of e.network.loadBalancers) if (lb.received !== lb.completed + lb.rejected + lb.cancelled + lb.active + lb.pending || lb.activeRetries < 0 || lb.backends.some((b) => b.outstanding < 0)) throw new Error("LB conservation");
  for (const r of e.resources) if (r.admitted !== r.completed + r.failed + r.cancelled + r.queued + r.serving + r.waiting) throw new Error("Compute invocation conservation");
}
test("request/response serialization, propagation, setup and compute compose analytically", () => {
  const e = networkRun(networkFixture({ count: 1, cpu: 100 })); expect(e.results[0]!.responseUs).toBe(470);
  expect(e.network.links[0]!.transmittedBytes + e.network.links[1]!.transmittedBytes).toBe(300); networkConservation(e);
});
test("persistent reuse removes repeated establishment through connection lifecycle", () => {
  const reused = networkRun(networkFixture({ count: 4, interval: 1000 })), fresh = networkRun(networkFixture({ count: 4, interval: 1000, reuse: false }));
  expect(reused.network.paths[0]!.pool.created).toBe(1); expect(fresh.network.paths[0]!.pool.created).toBe(4);
  expect(reused.results[1]!.responseUs).toBe(fresh.results[1]!.responseUs - 50); networkConservation(reused); networkConservation(fresh);
});
test("pool limits hold requests despite spare compute workers; multiplexing changes stream eligibility", () => {
  const serial = networkRun(networkFixture({ count: 8, interval: 1, cpu: 1000, slots: 16, acquireTimeout: 500, pending: 2 }));
  expect(serial.network.paths[0]!.failed).toBeGreaterThan(0); expect(serial.network.paths[0]!.pool.created).toBe(1);
  const multi = networkRun(networkFixture({ count: 8, interval: 1, cpu: 1000, slots: 16, cores: 4, streams: 8 }));
  expect(multi.network.paths[0]!.pool.created).toBe(1); expect(multi.counts.completed).toBe(8); networkConservation(serial); networkConservation(multi);
});
test("two-backend dependency topology carries real probe/request/response work and canonical replay", () => {
  const input = verticalFixture({ count: 12, interval: 800, connections: 4 }); const e = networkRun(input);
  expect(e.counts.completed).toBe(12); expect(e.network.loadBalancers[0]!.backends.every((b) => b.selected > 0 && b.probes > 0)).toBe(true); networkConservation(e);
  const shuffled = structuredClone(input); shuffled.resources.reverse(); shuffled.links.reverse(); shuffled.paths.reverse(); (shuffled.resources.find((r) => r.kind === "load-balancer") as LoadBalancer).backends.reverse();
  expect(networkRun(shuffled, 137)).toEqual(e);
});
test("partition times out at its owner while remote compute may continue", () => {
  const input = networkFixture({ count: 3, interval: 1000, cpu: 500, responseTimeout: 1000 }), q = quantities();
  input.networkInterventions = [{ id: "cut", kind: "partition", target: "in", at: q.q("cut.at", 100, "us"), duration: q.q("cut.duration", 1800, "us") }]; input.ledger.push(...q.ledger);
  const e = networkRun(input); expect(e.network.paths[0]!.reasons["response-timeout"]).toBeGreaterThan(0); expect(e.resources[0]!.completed).toBeGreaterThan(0); networkConservation(e);
});

test("bandwidth changes settle partial bytes and delay changes apply to propagation admission", () => {
  const input = networkFixture({ count: 1, bytes: 1000, responseBytes: 0, propagation: 0, establish: 0, cpu: 100 }), q = quantities();
  input.networkInterventions = [{ id: "slow", kind: "bandwidth", target: "out", at: q.q("slow.at", 500, "us"), duration: q.q("slow.duration", 2000, "us"), bandwidth: q.q("slow.bandwidth", 500000, "bytes/s") },
    { id: "delay", kind: "delay", target: "out", at: q.q("delay.at", 600, "us"), duration: q.q("delay.duration", 2000, "us"), delay: q.q("delay.us", 200, "us") }]; input.ledger.push(...q.ledger);
  const e = networkRun(input); expect(e.results[0]!.responseUs).toBe(1800); expect(e.network.links.find((l) => l.id === "out")!.transmittedBytes).toBe(1000); networkConservation(e);
});
test("health detection lags endpoint failure and threshold recovery; readiness differs from existence", () => {
  const input = verticalFixture({ count: 30, interval: 500, connections: 4 }), q = quantities();
  input.networkInterventions = [{ id: "backend-down", kind: "service-state", target: "a", at: q.q("down.at", 3000, "us"), duration: q.q("down.duration", 6000, "us"), alive: true, ready: false }]; input.ledger.push(...q.ledger);
  const m = createNetworkModel2(input); m.advanceTo(3500); expect(m.evidence().network.loadBalancers[0]!.backends.find((b) => b.id === "a")!.health).toBe(true);
  m.advanceTo(8500); expect(m.evidence().network.loadBalancers[0]!.backends.find((b) => b.id === "a")!.health).toBe(false);
  m.advanceTo(m.horizon); const e = m.evidence(); expect(e.network.loadBalancers[0]!.backends.find((b) => b.id === "a")!.health).toBe(true); expect(e.network.trace.totals["health-observation"]).toBeGreaterThan(0); networkConservation(e);
});
test("draining stops selection, permits in-flight completion and closes long work at explicit grace", () => {
  for (const grace of [0, 5000]) {
    const input = verticalFixture({ count: 30, interval: 100, cpu: 800, connections: 4 }), q = quantities();
    input.networkInterventions = [{ id: "drain", kind: "drain", target: "lb", backend: "a", at: q.q("drain.at", 2500, "us"), grace: q.q("drain.grace", grace, "us") }]; input.ledger.push(...q.ledger);
    const e = networkRun(input); const trace = e.network.trace.events;
    expect(trace.filter((e) => e.kind === "lb-selected" && e.at >= 2500 && e.detail === "a")).toHaveLength(0);
    expect(e.network.loadBalancers[0]!.backends.find((b) => b.id === "a")!.draining).toBe(true); networkConservation(e);
  }
});
test("safe retries create actual attempts; ambiguous non-idempotent retries require explicit opt-in", () => {
  const make = (safe: boolean) => {
    const input = verticalFixture({ count: 20, interval: 200, cpu: 1200, connections: 4, responseTimeout: 1500 }), q = quantities();
    const lb = input.resources.find((r) => r.kind === "load-balancer") as LoadBalancer;
    lb.retry = { maxAttempts: q.q("retry.max", 3, "count"), maxConcurrentRetries: q.q("retry.concurrent", 100, "count"), backoff: q.q("retry.backoff", 100, "us"), jitter: q.q("retry.jitter", 0.2, "ratio"), retryOn: ["response-timeout", "reset"], allowAmbiguousNonIdempotent: false };
    input.operations.forEach((o) => o.idempotency = safe ? "read-only" : "non-idempotent"); input.ledger.push(...q.ledger); return input;
  };
  const safe = networkRun(make(true)), unsafe = networkRun(make(false));
  expect(safe.network.loadBalancers[0]!.retries).toBeGreaterThan(0); expect(unsafe.network.loadBalancers[0]!.retries).toBe(0);
  expect(safe.network.loadBalancers[0]!.attempts).toBeGreaterThan(unsafe.network.loadBalancers[0]!.attempts); networkConservation(safe); networkConservation(unsafe);
});
test("caller timeout retains remote work, reset affects shared connection users, and idle expiry releases connections", () => {
  const input = networkFixture({ count: 4, interval: 1, cpu: 5000, timeout: 100, streams: 4, horizon: 20000 }), q = quantities();
  input.paths[0]!.pool.idleTimeout = q.q("idle.expiry", 100, "us");
  input.networkInterventions = [{ id: "reset", kind: "reset", target: "caller-app", at: q.q("reset.at", 1000, "us") }]; input.ledger.push(...q.ledger);
  const e = networkRun(input); expect(e.counts.deadlineExceeded).toBe(4); expect(e.network.paths[0]!.reasons.reset).toBe(4); expect(e.resources[0]!.completed).toBeGreaterThan(0); expect(e.network.paths[0]!.pool.connections).toBe(0); networkConservation(e);
});
test("unknown bytes and missing provenance are refused instead of silently becoming zero", () => {
  const input = networkFixture(); input.paths[0]!.bytes.light!.request = { kind: "unknown", unit: "bytes", provenance: ["unknown"], reason: "Unmeasured payload" };
  expect(() => createNetworkModel2(input)).toThrow("Unresolved");
  const bad = networkFixture(); bad.links[0]!.bandwidth.provenance = ["missing"]; expect(() => createNetworkModel2(bad)).toThrow("provenance");
});
test("endpoint suspension freezes local CPU without inventing process death or losing ownership", () => {
  const input = networkFixture({ count: 1, cpu: 1000, timeout: 10000, horizon: 5000 }), q = quantities();
  input.networkInterventions = [{ id: "suspend", kind: "service-state", target: "app", at: q.q("suspend.at", 500, "us"), duration: q.q("suspend.duration", 1000, "us"), alive: false, ready: false }]; input.ledger.push(...q.ledger);
  const m = createNetworkModel2(input); m.advanceTo(600); const before = m.evidence(); m.advanceTo(1400);
  expect(m.evidence().resources[0]!.consumedCoreUs).toBe(before.resources[0]!.consumedCoreUs); expect(m.evidence().resources[0]!.compute!.memory.ownership.requests).toBe(1);
  m.advanceTo(m.horizon); expect(m.evidence().counts.completed).toBe(1); networkConservation(m.evidence());
});
test("buffer overflow, zero bandwidth and connect timeout preserve distinct populations", () => {
  const input = networkFixture({ count: 8, interval: 1, streams: 8, connectTimeout: 20, establish: 50 });
  const failed = networkRun(input); expect(failed.network.paths[0]!.reasons["connect-timeout"]).toBe(8); networkConservation(failed);
  const congested = networkFixture({ count: 8, interval: 1, streams: 8, bandwidth: 100000 }), q = quantities();
  congested.links.find((l) => l.id === "out")!.bufferBytes = q.q("zero.buffer", 0, "bytes");
  congested.networkInterventions = [{ id: "stall", kind: "bandwidth", target: "out", at: q.q("stall.at", 100, "us"), duration: q.q("stall.duration", 500, "us"), bandwidth: q.q("stall.rate", 0, "bytes/s") }]; congested.ledger.push(...q.ledger);
  const e = networkRun(congested); expect(e.network.paths[0]!.reasons["link-overflow"]).toBeGreaterThan(0); expect(e.counts.completed).toBeGreaterThan(0); networkConservation(e);
});
test("internal default selects network; published Model 1 and explicit M2C remain separate", () => {
  const entry = resolveModel("2", { internal: true }); if (entry.version !== "2" || entry.workloadVersion !== "m2d/1") throw new Error("Wrong dispatch");
  expect(entry.create(networkFixture({ count: 1 })).evidence().workloadVersion).toBe("m2d/1"); expect(() => resolveModel("2")).toThrow("internal");
});
test("different paths share one authored bottleneck and observations do not change its service", () => {
  const input = verticalFixture({ count: 15, interval: 100, connections: 4 });
  const template = input.links.find((l) => l.id === "lb:a:req")!;
  input.links.push({ ...template, id: "trunk", from: "lb", to: "switch" });
  for (const backend of ["a", "b"]) { input.links.find((l) => l.id === `lb:${backend}:req`)!.from = "switch"; input.paths.find((p) => p.source === "lb" && p.target === backend)!.request.unshift("trunk"); }
  const e = networkRun(input); expect(e.network.links.find((l) => l.id === "trunk")!.acceptedBytes).toBeGreaterThan(1500); networkConservation(e);
  const m = createNetworkModel2(input); m.advanceTo(137); const evidence = m.evidence(); evidence.network.links[0]!.partitioned = true; evidence.networkConfiguration.paths[0]!.request.length = 0; m.advanceTo(m.horizon); expect(m.evidence()).toEqual(e);
  const q = quantities(), changed = structuredClone(input); changed.sampleInterval = q.q("network.otherSample", 137, "us"); changed.ledger.push(...q.ledger);
  const sampled = networkRun(changed); expect(sampled.results).toEqual(e.results); expect(sampled.network).toEqual(e.network);
});
test("3000 generated network cases conserve bytes, streams, calls and retries", () => {
  for (let i = 0; i < 3000; i++) {
    const n = (key: string, max: number) => 1 + Math.floor(keyedUniform("m2d-sweep", "case", String(i), key) * max);
    const opts = { count: n("count", 12), interval: n("arrival", 500), cpu: n("cpu", 600), cores: n("cores", 4), slots: n("workers", 8), horizon: 7000, sample: 1000, bytes: n("request", 500), responseBytes: n("response", 800), bandwidth: n("rate", 8) * 250000, propagation: n("propagation", 50), establish: n("establish", 100), connections: n("connections", 4), streams: n("streams", 4), pending: n("pending", 8) - 1, acquireTimeout: n("acquireTimeout", 2000), connectTimeout: n("connectTimeout", 1000), responseTimeout: n("responseTimeout", 3000), timeout: n("callerTimeout", 6000), raw: 30 };
    const input = i % 2 ? networkFixture(opts) : verticalFixture(opts), q = quantities();
    const link = input.links[n("link", input.links.length) - 1]!.id;
    if (i % 3 === 0) input.networkInterventions.push({ id: "partition", kind: "partition", target: link, at: q.q("sweep.partition.at", n("faultAt", 2000), "us"), duration: q.q("sweep.partition.duration", n("faultDuration", 2000), "us") });
    if (i % 5 === 0) input.networkInterventions.push({ id: "bandwidth", kind: "bandwidth", target: link, at: q.q("sweep.bandwidth.at", 500, "us"), duration: q.q("sweep.bandwidth.duration", 1500, "us"), bandwidth: q.q("sweep.bandwidth.rate", n("newRate", 4) * 100000, "bytes/s") });
    if (i % 7 === 0) input.networkInterventions.push({ id: "delay", kind: "delay", target: link, at: q.q("sweep.delay.at", 750, "us"), duration: q.q("sweep.delay.duration", 1250, "us"), delay: q.q("sweep.delay.us", n("delay", 2000), "us") });
    if (i % 2 === 0) {
      const lb = input.resources.find((r) => r.kind === "load-balancer") as LoadBalancer;
      lb.policy = i % 4 ? "least-outstanding" : "round-robin";
      lb.maxOutstanding = q.q("sweep.lb.outstanding", n("lbActive", 6), "count"); lb.maxPending = q.q("sweep.lb.pending", n("lbPending", 5) - 1, "count");
      lb.retry = { maxAttempts: q.q("sweep.retry.attempts", n("attempts", 3), "count"), maxConcurrentRetries: q.q("sweep.retry.concurrent", n("retryBudget", 4), "count"), backoff: q.q("sweep.retry.backoff", n("backoff", 300), "us"), jitter: q.q("sweep.retry.jitter", 0.3, "ratio"), retryOn: ["response-timeout", "connect-timeout", "reset", "link-overflow", "pool-overflow"], allowAmbiguousNonIdempotent: false };
      if (i % 6 === 0) input.networkInterventions.push({ id: "drain", kind: "drain", target: "lb", backend: "a", at: q.q("sweep.drain.at", 2000, "us"), grace: q.q("sweep.drain.grace", n("grace", 2000), "us") });
      if (i % 10 === 0) input.networkInterventions.push({ id: "readiness", kind: "service-state", target: "b", at: q.q("sweep.ready.at", 1000, "us"), duration: q.q("sweep.ready.duration", n("readiness", 4000), "us"), alive: true, ready: false });
    }
    if (i % 11 === 0) input.networkInterventions.push({ id: "reset", kind: "reset", target: input.paths[0]!.id, at: q.q("sweep.reset.at", 1500, "us") });
    input.operations.forEach((o) => { o.onCallerStop = i % 2 ? "detach" : "request-cancellation"; o.idempotency = i % 4 ? "read-only" : "unknown"; });
    input.ledger.push(...q.ledger); const m = createNetworkModel2(input); m.advanceTo(1750); networkConservation(m.evidence()); m.advanceTo(m.horizon); const e = m.evidence(); networkConservation(e);
    if (i % 100 === 0) expect(networkRun(input, 113)).toEqual(e);
  }
}, 120000);
