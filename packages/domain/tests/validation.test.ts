import { describe, expect, test } from "bun:test";
import { SAMPLE_ARCHITECTURE } from "../src/examples";
import { RESOURCE_TYPES, type ConnectionLine, type Resource, type ResourceType } from "../src/resource";
import { validateConnection, validateDeploymentReadiness } from "../src/validation";

const resource = (id: string, type: ResourceType): Resource => ({ id, type, x: 0, y: 0 });
const line = (sourceId: string, targetId: string): ConnectionLine => ({
  id: `${sourceId}-${targetId}`, sourceId, targetId, sourceType: "", targetType: "", port: 80,
});

describe("connection eligibility", () => {
  test("preserves allowed, forbidden, terminal and unknown-source results", () => {
    expect(validateConnection(RESOURCE_TYPES.DNS, RESOURCE_TYPES.CDN)).toEqual({ valid: true, message: "Connection valid" });
    expect(validateConnection(RESOURCE_TYPES.DNS, RESOURCE_TYPES.Database)).toEqual({
      valid: false, message: "DNS cannot connect to Database. Allowed: CDN, Load Balancer",
    });
    expect(validateConnection(RESOURCE_TYPES.ObjectStorage, RESOURCE_TYPES.Database)).toEqual({
      valid: false, message: "Object Storage cannot connect to any resource",
    });
    expect(validateConnection("unknown" as ResourceType, RESOURCE_TYPES.Database)).toEqual({
      valid: false, message: "Unknown source type: unknown",
    });
  });
});

describe("deployment readiness", () => {
  test("preserves sample warning wording and ordering", () => {
    expect(validateDeploymentReadiness(SAMPLE_ARCHITECTURE.resources, SAMPLE_ARCHITECTURE.connectionLines)).toEqual({
      valid: true, errors: [], warnings: [
        "monitor-1 cannot be reached from any entry point (DNS, CDN, Firewall, or Load Balancer)",
        "vm-2 has no downstream data path — data requests will fail",
      ],
    });
  });

  test("rejects empty input with the existing deployable requirement", () => {
    expect(validateDeploymentReadiness([], [])).toEqual({
      valid: false, errors: ["Infrastructure must contain at least one deployable resource (Virtual Machine, Database, or Object Storage)"], warnings: [],
    });
  });

  test("preserves presence errors before isolation errors and monitoring warnings", () => {
    expect(validateDeploymentReadiness([
      resource("dns", RESOURCE_TYPES.DNS), resource("cache", RESOURCE_TYPES.Cache),
      resource("queue", RESOURCE_TYPES.MessageQueue), resource("registry", RESOURCE_TYPES.ContainerRegistry),
    ], [])).toEqual({
      valid: false, errors: [
        "DNS requires a target (CDN or Load Balancer)", "Cache requires a database to cache data from",
        "Message Queue requires a consumer (Virtual Machine or Database)", "Container Registry requires at least one Virtual Machine",
        "Infrastructure must contain at least one deployable resource (Virtual Machine, Database, or Object Storage)",
        "dns is isolated — connect it or remove it", "cache is isolated — connect it or remove it",
        "queue is isolated — connect it or remove it", "registry is isolated — connect it or remove it",
      ], warnings: [],
    });
    expect(validateDeploymentReadiness([resource("monitor", RESOURCE_TYPES.MonitoringAgent)], []).warnings).toEqual([
      "Monitoring Agent has no resources to monitor",
    ]);
  });

  test("preserves load-balancer/CDN prerequisites and database backup warning", () => {
    expect(validateDeploymentReadiness([
      resource("lb", RESOURCE_TYPES.LoadBalancer), resource("cdn", RESOURCE_TYPES.CDN),
    ], [line("cdn", "lb")]).errors).toEqual([
      "Load balancer required at least one Virtual Machine as backend",
      "Infrastructure must contain at least one deployable resource (Virtual Machine, Database, or Object Storage)",
    ]);
    expect(validateDeploymentReadiness([resource("cdn", RESOURCE_TYPES.CDN)], []).errors[0]).toBe("CDN requires Load Balancer as origin");
    expect(validateDeploymentReadiness([
      resource("vm", RESOURCE_TYPES.VirtualMachine), resource("db", RESOURCE_TYPES.Database),
    ], [line("vm", "db")])).toEqual({
      valid: true, errors: [], warnings: [
        "vm cannot be reached from any entry point (DNS, CDN, Firewall, or Load Balancer)",
        "db cannot be reached from any entry point (DNS, CDN, Firewall, or Load Balancer)",
        "Database should have Object Storage for backup",
      ],
    });
  });

  test("reports isolated nodes as errors and reachable VM dead ends as warnings", () => {
    expect(validateDeploymentReadiness([
      resource("lb", RESOURCE_TYPES.LoadBalancer), resource("vm", RESOURCE_TYPES.VirtualMachine),
      resource("orphan", RESOURCE_TYPES.ObjectStorage),
    ], [line("lb", "vm")])).toEqual({
      valid: false, errors: ["orphan is isolated — connect it or remove it"],
      warnings: ["vm has no downstream data path — data requests will fail"],
    });
  });
});
