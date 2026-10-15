import { computeFixture } from "./computeFixture";
import { quantities } from "./workloadFixture";
import type { NetworkInput, PathConfig, LoadBalancer } from "../src/model2/network/contracts";
import type { ComputeResource } from "../src/model2/compute/contracts";

export function networkFixture(options: Parameters<typeof computeFixture>[0] & { bytes?: number; responseBytes?: number; bandwidth?: number; propagation?: number; establish?: number; connections?: number; streams?: number; pending?: number; responseTimeout?: number; acquireTimeout?: number; connectTimeout?: number; reuse?: boolean } = {}): NetworkInput {
  const base = computeFixture(options), q = quantities("Synthetic M2D link/connection verification; no real transport claim");
  const pool: PathConfig["pool"] = { mode: (options.streams ?? 1) > 1 ? "multiplexed" : "serial", reuse: options.reuse ?? true, maxConnections: q.q("net.connections", options.connections ?? 1, "count"), streams: q.q("net.streams", options.streams ?? 1, "count"), pending: q.q("net.pending", options.pending ?? 1000, "count"), establish: q.q("net.establish", options.establish ?? 50, "us"), acquireTimeout: q.q("net.acquireTimeout", options.acquireTimeout ?? 100000, "us"), connectTimeout: q.q("net.connectTimeout", options.connectTimeout ?? 10000, "us"), responseTimeout: q.q("net.responseTimeout", options.responseTimeout ?? 100000, "us"), remoteCancellation: "detach" };
  const input: NetworkInput = { ...base, workloadVersion: "m2d/1", resources: base.resources.filter((r): r is ComputeResource => r.kind === "compute"), endpoints: { app: { alive: true, ready: true } },
    links: [ ["out", "$caller", "app"], ["in", "app", "$caller"] ].map(([id, from, to]) => ({ id: id!, from: from!, to: to!, policy: "fifo-message/1", bandwidth: q.q(`net.${id}.bandwidth`, options.bandwidth ?? 1000000, "bytes/s"), propagation: q.q(`net.${id}.propagation`, options.propagation ?? 10, "us"), bufferBytes: q.q(`net.${id}.buffer`, 10000000, "bytes") })),
    paths: [{ id: "caller-app", source: "$caller", target: "app", request: ["out"], response: ["in"], pool,
      bytes: Object.fromEntries(base.operations.map((o) => [o.id, { request: q.q(`net.${o.id}.request`, options.bytes ?? 100, "bytes"), response: q.q(`net.${o.id}.response`, options.responseBytes ?? 200, "bytes") }])) }], networkInterventions: [] };
  input.limits.maxRequests = Math.max(input.limits.maxRequests, input.limits.maxRawResults);
  input.ledger.push(...q.ledger); return input;
}

export function verticalFixture(options: Parameters<typeof networkFixture>[0] = {}): NetworkInput {
  const input = networkFixture({ count: 50, interval: 100, horizon: 20000, slots: 4, timeout: 15000, raw: 2000, ...options }), q = quantities("Synthetic M2D distributed vertical proof; no provider/network calibration");
  const template = input.resources[0] as ComputeResource;
  const lb: LoadBalancer = { id: "lb", kind: "load-balancer", backends: ["a", "b"], policy: "round-robin", maxOutstanding: q.q("lb.outstanding", 100, "count"), maxPending: q.q("lb.pending", 100, "count"), pendingTimeout: q.q("lb.pendingTimeout", 10000, "us"),
    health: { interval: q.q("lb.health.interval", 2000, "us"), timeout: q.q("lb.health.timeout", 1500, "us"), healthy: q.q("lb.health.healthy", 1, "count"), unhealthy: q.q("lb.health.unhealthy", 2, "count"), initial: "eligible", operation: "light" } };
  input.resources = [lb, ...["a", "b", "dep"].map((id) => ({ ...structuredClone(template), id, ...(id === "dep" ? {} : { downstream: "dep" }) }))];
  input.endpoints = Object.fromEntries(input.resources.map((r) => [r.id, { alive: true, ready: true }]));
  input.operations.forEach((o) => o.entry = "lb");
  const pathTemplate = input.paths[0]!, linkTemplate = input.links[0]!;
  input.links = []; input.paths = [];
  for (const [source, target] of [["$caller", "lb"], ["lb", "a"], ["lb", "b"], ["a", "dep"], ["b", "dep"]]) {
    const id = `${source}:${target}`, request = `${id}:req`, response = `${id}:res`;
    input.links.push({ ...linkTemplate, id: request, from: source!, to: target! }, { ...linkTemplate, id: response, from: target!, to: source! });
    input.paths.push({ ...structuredClone(pathTemplate), id, source: source!, target: target!, request: [request], response: [response] });
  }
  input.ledger.push(...q.ledger); return input;
}
