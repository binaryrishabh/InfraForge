import { expect, test } from "bun:test";
import { RESOURCE_PORTS } from "@infraforge/domain/resource";
import { createProductModel2 } from "../src/model2/product/run";
import { createLiveModel2 } from "../src/model2/product/live";
import { securityDesign, prepareSecurity } from "./securityCanvas.fixture";

const vmPort = RESOURCE_PORTS["Virtual Machine"];
const allow = (id: string, direction: "ingress" | "egress") => ({ id, priority: direction === "ingress" ? 0 : 1, action: "allow" as const, direction, source: "lb", destination: "app", fromPort: vmPort, toPort: vmPort });
function design(listenerPorts?: number[]) {
  const d = securityDesign({ lb: "Load Balancer", app: "Virtual Machine", cache: "Cache", db: "Database", firewall: "Firewall" }, [["lb", "app"], ["app", "cache"], ["app", "db"], ["firewall", "app"]]);
  d.resources.find(r => r.id === "firewall")!.firewallSettings = { version: 1, default: "deny", rules: [allow("in", "ingress"), allow("out", "egress")] };
  if (listenerPorts) d.resources.find(r => r.id === "app")!.listenerSettings = { version: 1, ports: listenerPorts };
  return d;
}

test("a firewall on an app does not block the app's own calls between its internal roles", () => {
  const p = prepareSecurity(design()), runtime = createProductModel2(p.compiled); runtime.advanceTo(1000000);
  const e = runtime.evidence();
  expect(e.counts.completed).toBeGreaterThan(0);
  expect(e.systems.security.edges!.some(x => x.path.includes("/internal/"))).toBe(false);
  expect(e.systems.security.admission!.rows.some(r => !r.allowed)).toBe(false);
  const live = createLiveModel2(p.compiled, design().resources.map(r => r.id)); live.advanceSecond();
  expect(live.project().metrics.app!.health).not.toBe("failed");
});

test("a saved listener port on the app does not break its internal calls", () => {
  const d = design([vmPort]);
  const p = prepareSecurity(d), runtime = createProductModel2(p.compiled); runtime.advanceTo(1000000);
  expect(runtime.evidence().counts.completed).toBeGreaterThan(0);
});

test("autoscaled image bootstrap commands succeed behind a deny-by-default firewall", () => {
  const d = design();
  d.resources.find(r => r.id === "app")!.autoscaling = { enabled: true, minReplicas: 1, maxReplicas: 3, targetCpu: 60 };
  const p = prepareSecurity(d), runtime = createProductModel2(p.compiled); runtime.advanceTo(3000000);
  const e = runtime.evidence();
  expect(p.compiled.input.systems.commands.length).toBeGreaterThan(0);
  expect(e.systems.security.admission!.rows.filter(r => r.reason.startsWith("policy-denied"))).toEqual([]);
  expect(e.counts.completed).toBeGreaterThan(0);
});

test("closing a cache's saved ports refuses the app's connection to it (the dialled helper role follows the saved ports)", () => {
  const d = securityDesign({ lb: "Load Balancer", app: "Virtual Machine", cache: "Cache", db: "Database" }, [["lb", "app"], ["app", "cache"], ["cache", "db"]]);
  d.resources.find(r => r.id === "cache")!.listenerSettings = { version: 1, ports: [] };
  const p = prepareSecurity(d), runtime = createProductModel2(p.compiled); runtime.advanceTo(1000000);
  const edge = runtime.evidence().systems.security.edges!.find(x => x.target.startsWith("cache"))!;
  expect(edge.noListener).toBeGreaterThan(0);
  expect(edge.backendDeliveries).toBe(0);
});

test("a cache on a saved port still serves through its own internal hop (no silent fallback to the database)", () => {
  const d = securityDesign({ lb: "Load Balancer", app: "Virtual Machine", cache: "Cache", db: "Database" }, [["lb", "app"], ["app", "cache"], ["cache", "db"]]);
  d.resources.find(r => r.id === "cache")!.listenerSettings = { version: 1, ports: [6380] };
  d.connections.find(c => c.targetId === "cache")!.port = 6380;
  const p = prepareSecurity(d), runtime = createProductModel2(p.compiled); runtime.advanceTo(3000000);
  const e = runtime.evidence();
  expect(e.counts.completed).toBeGreaterThan(0);
  expect(e.data.caches![0]!.hits).toBeGreaterThan(0);
});

test("a connection id that contains /internal/ is still counted as an outside connection", () => {
  const d = securityDesign({ lb: "Load Balancer", app: "Virtual Machine", db: "Database" }, [["lb", "app"], ["app", "db"]]);
  d.connections[1]!.id = "x/internal/y"; d.resources.find(r => r.id === "db")!.listenerSettings = { version: 1, ports: [5432] };
  const p = prepareSecurity(d), runtime = createProductModel2(p.compiled); runtime.advanceTo(1000000);
  expect(runtime.evidence().systems.security.edges!.some(x => x.path.startsWith("x/internal/y"))).toBe(true);
});
