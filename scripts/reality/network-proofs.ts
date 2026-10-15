import { writeFileSync } from "node:fs";
import { createNetworkModel2 } from "../../packages/simulation/src/model2/network/run";
import { networkFixture, verticalFixture } from "../../packages/simulation/tests/networkFixture";
import { quantities } from "../../packages/simulation/tests/workloadFixture";
import type { NetworkInput, LoadBalancer } from "../../packages/simulation/src/model2/network/contracts";

export function networkProofInputs() {
  const reuse = networkFixture({ count: 8, interval: 1000 }), fresh = networkFixture({ count: 8, interval: 1000, reuse: false });
  const saturation = networkFixture({ count: 40, interval: 10, connections: 1, slots: 32, cpu: 1000, acquireTimeout: 2000, pending: 8 });
  const multiplexed = networkFixture({ count: 8, interval: 1, connections: 1, streams: 8, slots: 8, cores: 4, cpu: 1000 });
  const vertical = verticalFixture({ count: 40, interval: 300, connections: 4, horizon: 30000, timeout: 15000, responseTimeout: 6000, raw: 5000 }), q = quantities("Synthetic M2D vertical/fault proof; no real transport applicability");
  vertical.networkInterventions = [
    { id: "backend-not-ready", kind: "service-state", target: "a", at: q.q("vertical.down.at", 3000, "us"), duration: q.q("vertical.down.duration", 6000, "us"), alive: true, ready: false },
    { id: "dependency-partition", kind: "partition", target: "b:dep:res", at: q.q("vertical.partition.at", 10000, "us"), duration: q.q("vertical.partition.duration", 4000, "us") },
    { id: "drain-a", kind: "drain", target: "lb", backend: "a", at: q.q("vertical.drain.at", 17000, "us"), grace: q.q("vertical.drain.grace", 3000, "us") },
  ]; vertical.ledger.push(...q.ledger);
  const storm = verticalFixture({ count: 40, interval: 150, cpu: 1000, connections: 4, responseTimeout: 2000, horizon: 300000, raw: 5000 }), s = quantities("Synthetic bounded retry amplification proof");
  const lb = storm.resources.find((r) => r.kind === "load-balancer") as LoadBalancer;
  lb.health.unhealthy = s.q("storm.health.unhealthy", 100, "count");
  lb.health.interval = s.q("storm.health.interval", 20000, "us");
  lb.retry = { maxAttempts: s.q("storm.attempts", 3, "count"), maxConcurrentRetries: s.q("storm.concurrent", 16, "count"), backoff: s.q("storm.backoff", 100, "us"), jitter: s.q("storm.jitter", 0.2, "ratio"), retryOn: ["response-timeout", "reset"], allowAmbiguousNonIdempotent: false }; storm.ledger.push(...s.ledger);
  const noRetry = structuredClone(storm); delete (noRetry.resources.find((r) => r.kind === "load-balancer") as LoadBalancer).retry;
  const partition = verticalFixture({ count: 25, interval: 500, connections: 4, responseTimeout: 2000, raw: 5000 }), p = quantities();
  partition.networkInterventions = [{ id: "partition", kind: "partition", target: "a:dep:res", at: p.q("partition.at", 2000, "us"), duration: p.q("partition.duration", 5000, "us") }]; partition.ledger.push(...p.ledger);
  const graceful = verticalFixture({ count: 20, interval: 200, cpu: 500, connections: 4, raw: 5000 }), d = quantities();
  const drainingLb = graceful.resources.find((r) => r.kind === "load-balancer") as LoadBalancer;
  drainingLb.health.interval = d.q("drain.health.interval", 20000, "us"); drainingLb.health.timeout = d.q("drain.health.timeout", 10000, "us");
  graceful.networkInterventions = [{ id: "drain", kind: "drain", target: "lb", backend: "a", at: d.q("drain.at", 2500, "us"), grace: d.q("drain.grace", 5000, "us") }]; graceful.ledger.push(...d.ledger);
  const forced = structuredClone(graceful), f = quantities(); forced.networkInterventions = [{ id: "drain", kind: "drain", target: "lb", backend: "a", at: f.q("forced.at", 2500, "us"), grace: f.q("forced.grace", 0, "us") }]; forced.ledger.push(...f.ledger);
  return { reuse, fresh, saturation, multiplexed, vertical, storm, noRetry, partition, graceful, forced };
}
function capture(input: NetworkInput) {
  const model = createNetworkModel2(input), phases = [];
  for (const at of [2500, 3500, 6500, 8500, 12000, 18000].filter((t) => t <= model.horizon)) {
    model.advanceTo(at); const e = model.evidence(); phases.push({ at, counts: e.counts, resources: e.resources, links: e.network.links, paths: e.network.paths, loadBalancers: e.network.loadBalancers });
  }
  model.advanceTo(model.horizon); const e = model.evidence();
  return { counts: e.counts, resources: e.resources, network: e.network, results: e.results, retention: e.resultRetention, execution: e.execution, phases };
}
export const networkProofs = () => Object.fromEntries(Object.entries(networkProofInputs()).map(([name, input]) => [name, capture(input)]));
if (import.meta.main) { const proofs = networkProofs(); if (process.argv.includes("--write")) writeFileSync(new URL("../../docs/reality/m2d-proofs.json", import.meta.url), JSON.stringify(proofs, null, 2) + "\n"); console.log(JSON.stringify(Object.fromEntries(Object.entries(proofs).map(([name, p]) => [name, { counts: p.counts, paths: p.network.paths.map((x) => ({ id: x.id, failed: x.failed, created: x.pool.created, reused: x.pool.reused })), loadBalancers: p.network.loadBalancers }])))); }
