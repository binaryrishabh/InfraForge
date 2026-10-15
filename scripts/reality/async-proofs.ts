import { readFileSync, writeFileSync } from "node:fs";
import { asyncFixture } from "../../packages/simulation/tests/asyncFixture";
import { quantities } from "../../packages/simulation/tests/workloadFixture";
import { createAsyncModel2 } from "../../packages/simulation/src/model2/async/run";
import type { AsyncInput, WorkerConfig, BrokerConfig, PublisherConfig } from "../../packages/simulation/src/model2/async/contracts";
const run = (i: AsyncInput, cut?: number) => { const m = createAsyncModel2(i); m.advanceTo(cut ?? m.horizon); const e = m.evidence(); return { counts: e.counts, asynchronous: e.asynchronous, database: e.data.databases, paths: e.network.paths, links: e.network.links.map((l) => ({ id: l.id, offeredBytes: l.offeredBytes, transmittedBytes: l.transmittedBytes, deliveredBytes: l.deliveredBytes })), execution: e.execution, ledger: i.ledger }; };
const workers = (i: AsyncInput) => i.resources.filter((r) => r.kind === "async-worker") as WorkerConfig[];
export function asyncProofs() {
  const normal = run(asyncFixture({ database: true })), backlogInput = asyncFixture({ count: 24, interval: 20, processing: 1000, horizon: 100000 }), q = quantities("Synthetic M2F fault windows and async proof; no performance applicability");
  backlogInput.asyncInterventions = [{ id: "consumer-down", kind: "consumer-state", target: "worker-0", available: false, at: q.q("down.at", 1000, "us"), duration: q.q("down.duration", 15000, "us") }]; backlogInput.ledger.push(...q.ledger);
  const backlog = run(backlogInput, 12000), drained = run(backlogInput);
  const poisonInput = asyncFixture({ count: 4 }); workers(poisonInput)[0]!.poisonKeys = [JSON.stringify(["root", "load", JSON.stringify(["load", 0])])];
  const repeated = { count: 1, processing: 100, ackDelay: 3000, lease: 2000, horizon: 30000 };
  const duplicate = run(asyncFixture(repeated)), idempotent = run(asyncFixture({ ...repeated, idempotent: true }));
  const crashInput = asyncFixture({ count: 1, processing: 100, ackDelay: 5000, lease: 10000, horizon: 40000 }), c = quantities();
  crashInput.asyncInterventions.push({ id: "effect-ack-window", kind: "consumer-state", target: "worker-0", available: false, at: c.q("window.at", 2000, "us"), duration: c.q("window.duration", 10000, "us") }); crashInput.ledger.push(...c.ledger);
  const objectFailureInput = asyncFixture({ count: 8, maxAttempts: 20 }), f = quantities(); objectFailureInput.asyncInterventions.push({ id: "reads-down", kind: "object-access", target: "objects", reads: false, writes: true, at: f.q("reads.at", 1000, "us"), duration: f.q("reads.duration", 5000, "us") }); objectFailureInput.ledger.push(...f.ledger);
  const retry = (dedup: boolean) => { const i = asyncFixture({ count: 1 }), q = quantities(); (i.resources.find((r) => r.kind === "delivery-queue") as BrokerConfig).deduplicatePublishes = dedup; (i.resources.find((r) => r.kind === "async-publisher") as PublisherConfig).publishAttempts = q.q("publisher.retry", 2, "count"); const p = i.paths.find((p) => p.source === "publisher" && p.target === "broker")!; p.pool.responseTimeout = q.q("publisher.responseDeadline", 500, "us"); i.links.find((l) => l.id === p.response[0])!.propagation = q.q("publisher.confirmDelay", 1000, "us"); i.ledger.push(...q.ledger); return run(i); };
  const results = { normal, backlog, drained, poison: run(poisonInput), duplicate, idempotent, failureWindow: run(crashInput), objectFailure: run(objectFailureInput), publisherRetry: retry(false), publisherDedup: retry(true), smallObject: run(asyncFixture({ count: 1, objectBytes: 1024, bandwidth: 1000000, lease: 1000000, horizon: 1000000 })), largeObject: run(asyncFixture({ count: 1, objectBytes: 65536, bandwidth: 1000000, lease: 1000000, horizon: 1000000 })) };
  if (backlog.asynchronous.brokers[0]!.ready <= 10 || drained.asynchronous.brokers[0]!.acknowledged !== 24 || duplicate.asynchronous.workers[0]!.effects <= idempotent.asynchronous.workers[0]!.effects || results.poison.asynchronous.brokers[0]!.dlq.length !== 1 || results.failureWindow.asynchronous.workers[0]!.effects !== 2) throw Error("Async proof mechanism changed");
  return results;
}
if (import.meta.main) {
  const report = asyncProofs(), file = new URL("../../docs/reality/m2f-proofs.json", import.meta.url);
  if (process.argv.includes("--write")) writeFileSync(file, JSON.stringify(report, null, 2) + "\n"); else if (JSON.stringify(report) !== JSON.stringify(JSON.parse(readFileSync(file, "utf8")))) throw Error("M2F proof drift");
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([id, e]) => [id, { counts: e.counts, broker: (({ accepted, ready, inFlight, acknowledged, redelivered, deadLettered }) => ({ accepted, ready, inFlight, acknowledged, redelivered, deadLettered }))(e.asynchronous.brokers[0]!), workers: e.asynchronous.workers.map((w) => ({ effects: w.effects, failed: w.failed, deduplicated: w.deduplicated })) }]))));
}
