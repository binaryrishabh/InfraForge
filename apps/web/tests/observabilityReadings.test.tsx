import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ResourceMetrics } from "@infraforge/contracts/telemetry";
import { ResourceHealth, type Resource } from "@infraforge/domain/resource";
import { NodeLive } from "../src/features/live/NodeLive";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";

const render = (type: Resource["type"], id = "selected", ended = false) => renderToStaticMarkup(<NodeLive deploymentId="run" resource={{ id, type, x: 0, y: 0 }} resources={[]} controls={false} ended={ended} />);

for (const type of ["Monitoring Agent", "Object Storage", "Firewall"] as const) test(`${type} missing evidence remains Unknown before measurements and in an old run`, () => {
  for (const ended of [false, true]) {
    const html = render(type, "selected", ended);
    expect(html).toContain("<dd>Unknown</dd>"); expect(html).not.toContain("<dd>0</dd>");
    expect(html).not.toMatch(/provider|guarantee|exactly.once/i);
  }
});

test("selected-node readings only format injected values and preserve ambiguity, zero and missing fields", () => {
  const initial = useSimulationStore.getInitialState(), previous = initial.metrics;
  const metrics: ResourceMetrics = { cpu: 99, memory: null, health: ResourceHealth.HEALTHY, rps: 777,
    monitoring: { version: 1, generated: 321, collections: 654, collectionFailures: 987, exported: 0, dropped: 456, droppedBeforeExport: 123, discardedUnconfirmed: 234,
      batches: 345, failedBatches: 567, bufferedSamples: 678, bufferedBytes: 789, inFlightSamples: 890, inFlightBytes: null,
      freshness: [{ target: "app", measuredAt: 123456, ageUs: 54321, state: "stale" }] },
    objectStorage: { version: 1, storedBytes: 321, capacityBytes: 654, committedPuts: 987, replacedObjects: 123, removedObjects: 234, deletes: 0, "object-capacity": null },
    security: { version: 1, evidence: "complete", edges: [], firewall: { occupancy: 321, limit: 654, admissions: 987, generation: 1, policyDenied: 123, "flow-capacity": null } } };
  try {
    useSimulationStore.getState().prepareRun("run");
    useSimulationStore.getState().applySnapshot({ deploymentId: "run", timestamp: "2026-11-02T00:00:00Z", simulatedSeconds: 7, loadFraction: 1, health: "healthy", logs: [], metrics: {
      selected: metrics, other: { ...metrics, monitoring: { ...metrics.monitoring!, generated: 99999 }, objectStorage: { ...metrics.objectStorage!, storedBytes: 99999 }, security: { ...metrics.security!, firewall: { ...metrics.security!.firewall!, occupancy: 99999 } } },
    } });
    initial.metrics = useSimulationStore.getState().metrics;
    for (const [type, label] of [["Monitoring Agent", "Observations generated"], ["Object Storage", "Stored bytes"], ["Firewall", "Current flow occupancy"]] as const) {
      const html = render(type);
      expect(html).toContain(`<dt>${label}</dt><dd>321</dd>`); expect(html).not.toContain("99999"); expect(html).toContain("<dd>Unknown</dd>");
      expect(html).not.toMatch(/provider|exactly.once/i);
      expect(render(type, "other")).toContain(`<dt>${label}</dt><dd>99999</dd>`);
    }
    const monitor = render("Monitoring Agent");
    expect(monitor).toContain("<dt>Confirmed exported observations</dt><dd>0</dd>");
    expect(monitor).toContain("<dt>Dropped before export</dt><dd>123</dd>");
    expect(monitor).toContain("<dt>Discarded unconfirmed observations</dt><dd>234</dd>");
    expect(monitor).toContain("Backend arrival may have occurred without confirmation");
    expect(monitor).toContain("Missing observation does not establish application failure");
    expect(monitor).toContain("<dt>Measurement timestamp (us)</dt><dd>123456</dd>"); expect(monitor).toContain("<dt>Observation age (us)</dt><dd>54321</dd>");
    expect(monitor).toContain("<dd>stale</dd>");
    expect(monitor).toContain("<dt>Buffered samples</dt><dd>678</dd>"); expect(monitor).toContain("<dt>Buffered bytes</dt><dd>789</dd>");
    expect(monitor).toContain("<dt>In-flight samples</dt><dd>890</dd>");
    const objects = render("Object Storage");
    expect(objects).toContain("<dt>Committed puts</dt><dd>987</dd>"); expect(objects).toContain("<dt>Removed objects</dt><dd>234</dd>");
    expect(objects).toContain("<dt>Delete operations</dt><dd>0</dd>");
    const firewall = render("Firewall");
    expect(firewall).toContain("<dt>Policy denied opens</dt><dd>123</dd>"); expect(firewall).toContain("<dt>Flow capacity refusals</dt><dd>Unknown</dd>");
    expect(firewall.match(/Current flow occupancy/g)).toHaveLength(1); expect(firewall.match(/Security measurements/g)).toHaveLength(1);
    expect(render("Object Storage")).not.toContain("Observations generated"); expect(render("Virtual Machine")).not.toContain("Stored bytes");
    Reflect.deleteProperty(initial.metrics.selected!.monitoring!, "generated"); Reflect.deleteProperty(initial.metrics.selected!.objectStorage!, "storedBytes"); Reflect.deleteProperty(initial.metrics.selected!.security!.firewall!, "policyDenied");
    expect(render("Monitoring Agent")).toContain("<dt>Observations generated</dt><dd>Unknown</dd>");
    expect(render("Object Storage")).toContain("<dt>Stored bytes</dt><dd>Unknown</dd>");
    expect(render("Firewall")).toContain("<dt>Policy denied opens</dt><dd>Unknown</dd>");
    Object.assign(initial.metrics.selected!.monitoring!, { version: 2 }); Object.assign(initial.metrics.selected!.objectStorage!, { version: 2 }); Object.assign(initial.metrics.selected!.security!, { version: 2 });
    expect(render("Monitoring Agent")).not.toContain("<dd>654</dd>"); expect(render("Object Storage")).not.toContain("<dd>654</dd>"); expect(render("Firewall")).not.toContain("<dd>654</dd>");
  } finally { initial.metrics = previous; useSimulationStore.getState().reset(); }
});
