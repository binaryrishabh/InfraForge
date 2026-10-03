import { describe, expect, test } from "bun:test";
import { SAMPLE_ARCHITECTURE } from "../src/examples";
import { RESOURCE_TYPES, type ConnectionLine, type Resource, type ResourceType } from "../src/resource";
import { computeTopology } from "../src/topology";

const resource = (id: string, type: ResourceType): Resource => ({ id, type, x: 0, y: 0 });
const line = (sourceId: string, targetId: string): ConnectionLine => ({
  id: `${sourceId}-${targetId}`, sourceId, targetId, sourceType: "", targetType: "", port: 80,
});

describe("topology analysis", () => {
  test("preserves sample traversal order and dead-end classification", () => {
    expect(computeTopology(SAMPLE_ARCHITECTURE.resources, SAMPLE_ARCHITECTURE.connectionLines)).toEqual({
      adjacency: {
        "dns-1": ["cdn-1"], "cdn-1": ["lb-1"], "lb-1": ["vm-1", "vm-2"],
        "vm-1": ["cache-1"], "cache-1": ["db-1"], "db-1": ["storage-1"], "monitor-1": ["vm-1"],
      },
      upstream: {
        "cdn-1": ["dns-1"], "lb-1": ["cdn-1"], "vm-1": ["lb-1", "monitor-1"],
        "vm-2": ["lb-1"], "cache-1": ["vm-1"], "db-1": ["cache-1"], "storage-1": ["db-1"],
      },
      entryPoints: ["dns-1"],
      reachable: ["dns-1", "cdn-1", "lb-1", "vm-1", "vm-2", "cache-1", "db-1", "storage-1"],
      deadEnds: ["vm-2"], idle: ["monitor-1"],
    });
  });

  test("handles empty input and a graph with no qualifying entry", () => {
    expect(computeTopology([], [])).toEqual({
      adjacency: {}, upstream: {}, entryPoints: [], reachable: [], deadEnds: [], idle: [],
    });
    const result = computeTopology([
      resource("vm", RESOURCE_TYPES.VirtualMachine), resource("db", RESOURCE_TYPES.Database),
    ], [line("vm", "db")]);
    expect(result.entryPoints).toEqual([]);
    expect(result.reachable).toEqual([]);
    expect(result.deadEnds).toEqual([]);
    expect(result.idle).toEqual(["vm", "db"]);
  });

  test("DNS remains an entry in a cycle; duplicate edges retain order", () => {
    const result = computeTopology([
      resource("dns", RESOURCE_TYPES.DNS), resource("lb", RESOURCE_TYPES.LoadBalancer),
      resource("vm", RESOURCE_TYPES.VirtualMachine), resource("idle", RESOURCE_TYPES.Database),
    ], [line("vm", "dns"), line("dns", "lb"), line("lb", "vm"), line("lb", "vm")]);
    expect(result).toEqual({
      adjacency: { vm: ["dns"], dns: ["lb"], lb: ["vm", "vm"] },
      upstream: { dns: ["vm"], lb: ["dns"], vm: ["lb", "lb"] },
      entryPoints: ["dns"], reachable: ["dns", "lb", "vm"], deadEnds: [], idle: ["idle"],
    });
  });

  test("preserves multiple entries and dangling endpoint traversal", () => {
    const result = computeTopology([
      resource("cdn", RESOURCE_TYPES.CDN), resource("firewall", RESOURCE_TYPES.Firewall),
      resource("lb", RESOURCE_TYPES.LoadBalancer), resource("dns", RESOURCE_TYPES.DNS),
      resource("vm", RESOURCE_TYPES.VirtualMachine),
    ], [line("cdn", "lb"), line("firewall", "vm"), line("vm", "missing"), line("missing", "missing")]);
    expect(result.entryPoints).toEqual(["cdn", "firewall", "dns"]);
    expect(result.reachable).toEqual(["cdn", "firewall", "dns", "lb", "vm", "missing"]);
    expect(result.deadEnds).toEqual([]);
    expect(result.idle).toEqual([]);
  });

  test("does not mutate input resources or connections", () => {
    const resources = structuredClone(SAMPLE_ARCHITECTURE.resources);
    const connections = structuredClone(SAMPLE_ARCHITECTURE.connectionLines);
    computeTopology(resources, connections);
    expect(resources).toEqual(SAMPLE_ARCHITECTURE.resources);
    expect(connections).toEqual(SAMPLE_ARCHITECTURE.connectionLines);
  });
});
