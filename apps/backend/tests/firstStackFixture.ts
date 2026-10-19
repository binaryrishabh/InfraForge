import type { FirstStackSidecar } from "@infraforge/contracts/first-stack";
import { designRevision } from "../firstStack/canonical";
export function firstStackFixture(apps = 2, cache = false) {
  const resources = [
    { id: "lb", type: "Load Balancer", x: 12, y: 4, skuId: "historical-metadata", public: false },
    ...Array.from({ length: apps }, (_, i) => ({ id: `app-${i}`, type: "Virtual Machine", x: i * 10, y: 10 })),
    { id: "db", type: "Database", x: 2, y: 20 },
    ...(cache ? [{ id: "cache", type: "Cache", x: 30, y: 20 }] : []),
  ];
  const connectionLines = Array.from({ length: apps }, (_, i) => [
    { id: `lb-${i}`, sourceId: "lb", targetId: `app-${i}`, sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80 },
    { id: `db-${i}`, sourceId: `app-${i}`, targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432 },
  ]).flat();
  const layout = { resources, connectionLines, layoutVersion: 1 };
  const sidecar: FirstStackSidecar = {
    schema: "infraforge-first-stack-sidecar/1", profile: "first-stack/1", compiler: "first-stack-authoring/1", designRevision: designRevision(layout),
    application: { id: "test-authored", version: "1", origin: "authored", workloadDomain: "finite test only", runtime: "authored test runtime", hardware: "authored test host", sources: ["explicit test assumptions"] },
    operations: ["read", "health"].map(id => ({ id, kind: id === "health" ? "health-read" : "point-read", plan: "read-plan", deadlineUs: 1000, requestBytes: 1, responseBytes: 2, cpuUs: 10, parallelism: 1, blockingUs: 0, residentBytes: null })),
    nodes: resources.map(r => ({ id: r.id, owner: r.id === "lb" ? "load-balancer" : r.id === "db" ? "relational" : r.id === "cache" ? "keyed-cache" : "compute", host: `host-${r.id}`, cores: 1, memoryBytes: null, reservationBytes: null, workers: 2, queue: 4, listenerPort: r.id === "db" ? 5432 : r.id === "cache" ? 6379 : 80, cancellation: "detach" })),
    caller: { entry: "lb", port: 80, transport: "plain-serial/1", connections: 2, pending: 4, timeoutUs: 1000, requestBytes: 1, responseBytes: 2, requestLink: "out", responseLink: "back" },
    paths: connectionLines.map(e => ({ id: e.id, source: e.sourceId, target: e.targetId, purpose: e.sourceId === "lb" ? "routing" : "dependency", port: e.port, transport: "plain-serial/1", connections: 2, pending: 4, timeoutUs: 1000, requestBytes: 1, responseBytes: 2, requestLink: "out", responseLink: "back" })),
    links: ["out", "back"].map(id => ({ id, bytesPerSecond: 1_000_000, latencyUs: 1, queueBytes: 1000 })),
    placement: resources.map(r => ({ id: `host-${r.id}`, cores: 1, memoryBytes: null })),
    balancer: { policy: "round-robin", outstanding: 8, pending: 8, timeoutUs: 1000, healthOperation: "health", intervalUs: 10000, healthy: 1, unhealthy: 1, allUnhealthy: "reject" },
    database: { semantics: "read-committed-keyed/1", keys: ["hot", "cold"], maxSessions: 8, activeTransactions: 2, pendingQueries: 8, initial: ["hot", "cold"].map(key => ({ key, version: 1, bytes: 2 })),
      plans: [{ id: "read-plan", kind: "read", keys: "recorded", cpuUs: 5, parallelism: 1, blockingUs: 0, logBytes: 0, statementTimeoutUs: 1000, lockTimeoutUs: 1000, transactionTimeoutUs: 1000, commitWaitUs: 0, durability: "logical-only" }] },
    workload: null, faults: [], metrics: "first-stack-metrics/1", retention: "first-stack-bounded/1", sources: ["test-only"] };
  return { layout, sidecar };
}
