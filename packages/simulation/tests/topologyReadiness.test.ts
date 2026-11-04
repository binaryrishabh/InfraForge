import { expect, test } from "bun:test";
import { RESOURCE_PORTS, RESOURCE_TYPES, type Resource } from "@infraforge/domain/resource";
import { validateConnection } from "@infraforge/domain/validation";
import { validateModel2Readiness } from "../src/model2/product/readiness";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { design as asyncDesign } from "./asyncCanvas.fixture";
import { eventBusDesign } from "./eventBus.fixture";
import { gatewayDesign } from "./apiGateway.fixture";

function design(types: Record<string, Resource["type"]>, links: [string, string][] = []): SavedProductDesign {
  return { schema: "infraforge-saved-design/1", resources: Object.entries(types).map(([id, type]) => ({ id, type, x: 0, y: 0 })),
    connections: links.map(([s, t], i) => ({ id: `e${i}`, sourceId: s, targetId: t, sourceType: types[s]!, targetType: types[t]!, port: RESOURCE_PORTS[types[t]!] })),
    workload: { targetThroughput: 60, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 0.8, payloadSize: "light" } };
}

const supported = [
  design({ app: "Virtual Machine" }),
  design({ dns: "DNS", app: "Virtual Machine" }, [["dns", "app"]]),
  design({ cdn: "CDN", store: "Object Storage" }, [["cdn", "store"]]),
  design({ app: "Virtual Machine", registry: "Container Registry", store: "Object Storage" }, [["app", "registry"], ["registry", "store"]]),
  design({ cdn: "CDN", registry: "Container Registry", store: "Object Storage" }, [["cdn", "store"], ["registry", "store"]]),
  design({ lb: "Load Balancer", app: "Virtual Machine" }, [["lb", "app"]]),
  design({ app: "Virtual Machine", cache: "Cache", db: "Database" }, [["app", "cache"], ["cache", "db"]]),
  design({ app: "Virtual Machine", cache: "Cache", db: "Database" }, [["app", "cache"], ["app", "db"]]),
  design({ app: "Virtual Machine", store: "Object Storage" }, [["app", "store"]]),
  design({ app: "Virtual Machine", queue: "Message Queue" }, [["app", "queue"]]),
  design({ monitor: "Monitoring Agent", app: "Virtual Machine" }, [["monitor", "app"]]),
  asyncDesign(), eventBusDesign(), gatewayDesign(),
];

for (const [i, d] of supported.entries()) test(`regression: supported topology ${i}: drawable, ready and compiled`, () => {
  expect(contractFromDesign(d)).not.toHaveProperty("refused");
  for (const e of d.connections) expect(validateConnection(e.sourceType as Resource["type"], e.targetType as Resource["type"], "draw").valid).toBe(true);
  expect(validateModel2Readiness(d.resources, d.connections).valid).toBe(true);
});

for (const type of Object.values(RESOURCE_TYPES)) {
  test(`regression: policy attachments and monitoring eligibility: ${type}`, () => {
    expect(validateConnection("Firewall", type, "draw").valid).toBe(type !== "Firewall");
    expect(validateConnection("Monitoring Agent", type, "draw").valid).toBe(type !== "Firewall");
    // Event Bus v1 accepts only one publisher and its subscription queues; an observer link is refused as not runnable.
    if (type === "Firewall" || type === "Event Bus") return;
    const base = supported.find(d => d.resources.some(r => r.type === type))!;
    for (const source of ["Firewall", "Monitoring Agent"] as const) {
      const d = structuredClone(base), target = d.resources.find(r => r.type === type)!;
      d.resources.push({ id: "observer", type: source, x: 0, y: 0 });
      // DNS resolves through its resolver role; cache-aside reads use the aside role.
      // A policy attachment needs an actual admitted path to the target's primary role.
      if (source === "Firewall" && ["DNS", "Cache", "Monitoring Agent"].includes(type)) {
        d.resources.push({ id: "primary-monitor", type: "Monitoring Agent", x: 0, y: 0 });
        d.connections.push({ id: "primary-path", sourceId: "primary-monitor", targetId: target.id, sourceType: "Monitoring Agent", targetType: type, port: RESOURCE_PORTS[type] });
      }
      d.connections.push({ id: "observe", sourceId: "observer", targetId: target.id, sourceType: source, targetType: type, port: RESOURCE_PORTS[type] });
      expect(contractFromDesign(d)).not.toHaveProperty("refused");
      expect(validateModel2Readiness(d.resources, d.connections).valid).toBe(true);
    }
  });
}

const refused = [
  design({ cdn: "CDN", lb: "Load Balancer", app: "Virtual Machine" }, [["cdn", "lb"], ["lb", "app"]]),
  design({ app: "Virtual Machine", db: "Database", store: "Object Storage" }, [["app", "db"], ["db", "store"]]),
  design({ app: "Virtual Machine", queue: "Message Queue", db: "Database" }, [["app", "queue"], ["app", "db"], ["queue", "db"]]),
  design({ app: "Virtual Machine", queue: "Message Queue", worker: "Virtual Machine" }, [["app", "queue"], ["queue", "worker"]]),
  design({ dns: "DNS", lb: "Load Balancer", app: "Virtual Machine" }, [["dns", "app"], ["lb", "app"]]),
  design({ app: "Virtual Machine", cache: "Cache", db: "Database", other: "Database" }, [["app", "cache"], ["cache", "db"], ["cache", "other"]]),
];
for (const [i, d] of refused.entries()) test(`unsupported topology ${i} fails readiness before execution`, () => {
  const built = contractFromDesign(d);
  expect(built).toHaveProperty("refused");
  const ready = validateModel2Readiness(d.resources, d.connections);
  expect(ready.valid).toBe(false);
  if ("refused" in built) for (const diagnostic of built.refused) expect(ready.errors).toContain(diagnostic.message);
});

test("obsolete CDN, database backup and ordinary queue consumer drawing directions are refused", () => {
  for (const [s, t] of [["CDN", "Load Balancer"], ["Database", "Object Storage"], ["Message Queue", "Database"]] as const) expect(validateConnection(s, t, "draw").valid).toBe(false);
});

test("service call eligibility stays conditional on the exact source flow edge", () => {
  for (const target of ["Virtual Machine", "Load Balancer"] as const) {
    const d = target === "Load Balancer" ? design({ app: "Virtual Machine", service: target, backend: "Virtual Machine" }, [["app", "service"], ["service", "backend"]]) : design({ app: "Virtual Machine", service: target }, [["app", "service"]]);
    const app = d.resources[0]!;
    expect(validateModel2Readiness(d.resources, d.connections).valid).toBe(false);
    app.applicationFlow = { schema: "application-flow/1", operations: { read: { steps: [{ id: "call", kind: "call", edge: "wrong" }] } } };
    expect(validateModel2Readiness(d.resources, d.connections).valid).toBe(false);
    app.applicationFlow.operations.read!.steps = [{ id: "call", kind: "call", edge: "e0" }];
    expect(contractFromDesign(d)).not.toHaveProperty("refused");
    expect(validateModel2Readiness(d.resources, d.connections).valid).toBe(true);
  }
});

test("async publish readiness rejects missing publish and worker bindings", () => {
  const d = asyncDesign();
  d.resources[0]!.applicationFlow = { schema: "application-flow/3", operations: { write: { steps: [{ id: "publish", kind: "publish", edge: "e0" }] } } };
  expect(contractFromDesign(d)).not.toHaveProperty("refused");
  expect(validateModel2Readiness(d.resources, d.connections).valid).toBe(true);
  d.connections = d.connections.filter(e => e.sourceId !== "worker");
  expect(contractFromDesign(d)).toHaveProperty("refused");
  expect(validateModel2Readiness(d.resources, d.connections).valid).toBe(false);
});
