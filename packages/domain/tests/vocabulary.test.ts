import { describe, expect, test } from "bun:test";
import { DeploymentChaosNames, RESOURCE_PORTS, RESOURCE_TYPES, ResourceHealth } from "../src/resource";
import { DEFAULT_WORKLOAD_PROFILE } from "../src/workload";
import { SAMPLE_ARCHITECTURE } from "../src/examples";

describe("resource and workload vocabulary", () => {
  test("preserves resource labels and listening ports", () => {
    expect(Object.values(RESOURCE_TYPES)).toEqual([
      "DNS", "CDN", "Firewall", "Load Balancer", "Virtual Machine",
      "Container Registry", "Cache", "Database", "Object Storage", "Message Queue", "Monitoring Agent", "API Gateway", "Serverless Function", "Scheduler", "Event Bus",
    ]);
    expect(RESOURCE_PORTS).toEqual({
      DNS: 53, CDN: 443, Firewall: 443, "Load Balancer": 80, "Virtual Machine": 80,
      "Container Registry": 443, Cache: 6379, Database: 5432, "Object Storage": 443,
      "Message Queue": 5672, "Monitoring Agent": 9090, "Event Bus": 443, "API Gateway": 443, Scheduler: 443, "Serverless Function": 443,
    });
  });

  test("preserves health, chaos and the default workload", () => {
    expect(Object.values(ResourceHealth).map(String)).toEqual(["healthy", "degraded", "saturated", "failed", "unknown"]);
    expect(Object.values(DeploymentChaosNames).map(String)).toEqual([
      "crash", "network-delay", "cpu-spike", "memory-leak", "disk-failure",
    ]);
    expect(DEFAULT_WORKLOAD_PROFILE).toEqual({
      targetThroughput: 1_000_000, throughputUnit: "per-hour", trafficShape: "steady", payloadSize: "medium",
    });
  });

  test("preserves sample node order, coordinates and edge order", () => {
    expect(SAMPLE_ARCHITECTURE.resources.map(({ id, type, x, y }) => [id, type, x, y])).toEqual([
      ["dns-1", "DNS", 0, 0], ["lb-1", "Load Balancer", 0, 288],
      ["vm-1", "Virtual Machine", 432, 0], ["vm-2", "Virtual Machine", 432, 576],
      ["cache-1", "Cache", 864, 288], ["db-1", "Database", 1296, 288],
    ]);
    expect(SAMPLE_ARCHITECTURE.connectionLines.map(({ id, sourceId, targetId, port }) => [id, sourceId, targetId, port])).toEqual([
      ["c1", "dns-1", "lb-1", 80], ["c2", "lb-1", "vm-1", 80],
      ["c3", "lb-1", "vm-2", 80], ["c4", "vm-1", "cache-1", 6379],
      ["c5", "vm-2", "cache-1", 6379], ["c6", "cache-1", "db-1", 5432],
    ]);
  });
});
