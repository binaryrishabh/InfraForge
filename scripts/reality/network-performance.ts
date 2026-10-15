import { writeFileSync } from "node:fs";
import { verticalFixture } from "../../packages/simulation/tests/networkFixture";
import { createNetworkModel2 } from "../../packages/simulation/src/model2/network/run";
import type { ComputeResource } from "../../packages/simulation/src/model2/compute/contracts";
import type { LoadBalancer } from "../../packages/simulation/src/model2/network/contracts";
import { quantities } from "../../packages/simulation/tests/workloadFixture";

const cases = [];
for (const scenario of [{ backends: 2 }, { backends: 8 }, { backends: 24 }, { backends: 8, stress: true }]) {
  const { backends } = scenario;
  const input = verticalFixture({ count: 5000, interval: 10, horizon: 3000000, timeout: 100000000, cpu: 50, bytes: 64, responseBytes: 128, connections: scenario.stress ? 256 : 16, streams: scenario.stress ? 1 : 4, establish: scenario.stress ? 50000 : 50, connectTimeout: 1000000, pending: 10000, responseTimeout: 100000000, acquireTimeout: 100000000, slots: 32, cores: 4, raw: 100, sample: 1000000 });
  const lb = input.resources.find((r) => r.kind === "load-balancer") as LoadBalancer;
  const q = quantities("Local M2D executor timing scenario; no hardware performance claim");
  lb.maxOutstanding = q.q("perf.active", 10000, "count"); lb.maxPending = q.q("perf.pending", 10000, "count"); lb.health.interval = q.q("perf.health.interval", 100000, "us"); lb.health.timeout = q.q("perf.health.timeout", 50000, "us");
  const base = input.resources.find((r) => r.id === "a") as ComputeResource;
  if (scenario.stress) {
    lb.health.unhealthy = q.q("perf.health.unhealthy", 100, "count");
    lb.retry = { maxAttempts: q.q("perf.retry.max", 2, "count"), maxConcurrentRetries: q.q("perf.retry.concurrent", 256, "count"), backoff: q.q("perf.retry.backoff", 100, "us"), jitter: q.q("perf.retry.jitter", 0.2, "ratio"), retryOn: ["reset", "response-timeout"], allowAmbiguousNonIdempotent: false };
    input.networkInterventions = [{ id: "reset", kind: "reset", target: "lb:a", at: q.q("perf.reset.at", 150000, "us") }];
  }
  for (let n = 2; n < backends; n++) {
    const id = `backend-${String(n).padStart(2, "0")}`; input.resources.push({ ...structuredClone(base), id }); input.endpoints[id] = { alive: true, ready: true }; lb.backends.push(id);
    for (const [source, target] of [["lb", id], [id, "dep"]]) {
      const template = input.paths.find((p) => p.source === "lb" && p.target === "a")!, path = { ...structuredClone(template), id: `${source}:${target}`, source: source!, target: target!, request: [`${source}:${target}:req`], response: [`${source}:${target}:res`] };
      input.paths.push(path); input.links.push({ ...input.links[0]!, id: path.request[0]!, from: source!, to: target! }, { ...input.links[0]!, id: path.response[0]!, from: target!, to: source! });
    }
  }
  if (scenario.stress) for (const path of input.paths) if (path.source === "lb") path.pool.responseTimeout = q.q(`perf.${path.id}.responseTimeout`, 2000, "us");
  input.ledger.push(...q.ledger); const start = performance.now(), model = createNetworkModel2(input), setupMs = performance.now() - start;
  const execute = performance.now(); model.advanceTo(model.horizon); const executeMs = performance.now() - execute;
  const aggregate = performance.now(), e = model.evidence(), aggregationMs = performance.now() - aggregate;
  const serialize = performance.now(), json = JSON.stringify(e), serializationMs = performance.now() - serialize;
  if (e.counts.completed + e.counts.rejected !== 5000 || e.counts.inFlight) throw new Error("Network performance root population did not drain");
  cases.push({ backends, stress: scenario.stress ?? false, links: input.links.length, paths: input.paths.length, setupMs, executeMs, aggregationMs, serializationMs, bytes: Buffer.byteLength(json), execution: e.execution, counts: e.counts, retryAttempts: e.network.loadBalancers[0]!.retries,
    connectionsCreated: e.network.paths.reduce((n, p) => n + p.pool.created, 0), livePathExchanges: e.network.paths.reduce((n, p) => n + p.live, 0), pendingAcquisitions: e.network.paths.reduce((n, p) => n + p.pool.pending, 0), activeStreams: e.network.paths.reduce((n, p) => n + p.pool.activeStreams, 0), retainedTrace: e.network.trace.retained, omittedTrace: e.network.trace.omitted, heapUsed: process.memoryUsage().heapUsed });
}
const report = { scope: "Owner-local Bun executor timings only; uncontrolled GC/interference; no real transport capacity claim", cases };
writeFileSync(new URL("../../docs/reality/m2d-performance.json", import.meta.url), JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
