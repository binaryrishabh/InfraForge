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
      valid: false, message: "DNS cannot connect to Database. Allowed: CDN, Load Balancer, Virtual Machine",
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
  test("structural warnings do not predict failed requests or unsupported database backups", () => {
    expect(validateDeploymentReadiness([
      resource("lb", RESOURCE_TYPES.LoadBalancer), resource("vm", RESOURCE_TYPES.VirtualMachine),
    ], [line("lb", "vm")]).warnings).toEqual(["vm has no downstream connections"]);
    expect(validateDeploymentReadiness([
      resource("vm", RESOURCE_TYPES.VirtualMachine), resource("db", RESOURCE_TYPES.Database),
    ], [line("vm", "db")]).warnings).not.toContain("Database should have Object Storage for backup");
  });
  test("reports sample structural warnings in traversal order", () => {
    expect(validateDeploymentReadiness(SAMPLE_ARCHITECTURE.resources, SAMPLE_ARCHITECTURE.connectionLines)).toEqual({
      valid: true, errors: [], warnings: [
        "monitor-1 is not downstream of DNS, CDN, Firewall, or Load Balancer",
        "vm-2 has no downstream connections",
      ],
    });
  });

  test("rejects empty input", () => {
    expect(validateDeploymentReadiness([], [])).toEqual({
      valid: false, errors: ["Infrastructure must contain at least one resource"], warnings: [],
    });
  });

  test("reports isolation without engine-specific type-presence prerequisites", () => {
    expect(validateDeploymentReadiness([
      resource("dns", RESOURCE_TYPES.DNS), resource("cache", RESOURCE_TYPES.Cache),
      resource("queue", RESOURCE_TYPES.MessageQueue), resource("registry", RESOURCE_TYPES.ContainerRegistry),
    ], [])).toEqual({
      valid: false, errors: [
        "dns is isolated — connect it or remove it", "cache is isolated — connect it or remove it",
        "queue is isolated — connect it or remove it", "registry is isolated — connect it or remove it",
      ], warnings: [],
    });
    expect(validateDeploymentReadiness([resource("monitor", RESOURCE_TYPES.MonitoringAgent)], []).warnings).toEqual([
      "Monitoring Agent has no resources to monitor",
    ]);
  });

  test("leaves origin/backend eligibility to the engine", () => {
    expect(validateDeploymentReadiness([
      resource("lb", RESOURCE_TYPES.LoadBalancer), resource("cdn", RESOURCE_TYPES.CDN),
    ], [line("cdn", "lb")]).errors).toEqual([]);
    expect(validateDeploymentReadiness([resource("cdn", RESOURCE_TYPES.CDN)], []).errors).toEqual(["cdn is isolated — connect it or remove it"]);
    expect(validateDeploymentReadiness([
      resource("vm", RESOURCE_TYPES.VirtualMachine), resource("db", RESOURCE_TYPES.Database),
    ], [line("vm", "db")])).toEqual({
      valid: true, errors: [], warnings: [
        "vm is not downstream of DNS, CDN, Firewall, or Load Balancer",
        "db is not downstream of DNS, CDN, Firewall, or Load Balancer",
      ],
    });
  });

  test("permits a standalone VM and rejects dangling endpoints", () => {
    expect(validateDeploymentReadiness([resource("app", RESOURCE_TYPES.VirtualMachine)], []).valid).toBe(true);
    expect(validateDeploymentReadiness([resource("app", RESOURCE_TYPES.VirtualMachine)], [line("app", "missing")]).errors).toContain("app-missing must connect resources that exist on the canvas");
  });

  test("reports isolated nodes as errors and reachable VM dead ends as warnings", () => {
    expect(validateDeploymentReadiness([
      resource("lb", RESOURCE_TYPES.LoadBalancer), resource("vm", RESOURCE_TYPES.VirtualMachine),
      resource("orphan", RESOURCE_TYPES.ObjectStorage),
    ], [line("lb", "vm")])).toEqual({
      valid: false, errors: ["orphan is isolated — connect it or remove it"],
      warnings: ["vm has no downstream connections"],
    });
  });
});
