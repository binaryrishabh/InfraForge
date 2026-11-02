import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResourceHealth, type Resource } from "@infraforge/domain/resource";
import { NodeLive } from "../src/features/live/NodeLive";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";

const render = (type: Resource["type"], id = "selected", ended = false) => renderToStaticMarkup(<NodeLive deploymentId="run" resource={{ id, type, x: 0, y: 0 }} resources={[]} controls={false} ended={ended} />);

for (const [type, count] of [["Database", 6], ["Cache", 5], ["CDN", 10]] as const) test(`${type} missing fields remain Unknown before measurements and after an old run`, () => {
  expect(render(type).match(/<dd>Unknown<\/dd>/g)).toHaveLength(count);
  expect(render(type, "selected", true).match(/<dd>Unknown<\/dd>/g)).toHaveLength(count);
});

test("selected resource only formats injected evidence, including zero, partial fields and unrelated counters", () => {
  const initial = useSimulationStore.getInitialState(), previous = initial.metrics;
  try {
    useSimulationStore.getState().prepareRun("run");
    useSimulationStore.getState().applySnapshot({ deploymentId: "run", timestamp: "2026-11-02T00:00:00Z", simulatedSeconds: 7, loadFraction: 1, health: "healthy", logs: [], metrics: {
      selected: { cpu: 99, memory: null, health: ResourceHealth.HEALTHY, rps: 777, database: { version: 1, serving: 321, waiting: null, queued: 654, rejected: 987, sessionRefused: 0, "query-queue-full": null }, cache: { version: 1, hits: 123, misses: 456, expirations: 0, evictions: null, coalescedWaiters: 789 }, cdn: { version: 1, hits: 234, misses: 567, originRequests: 890, fills: 135, expirations: 0, evictions: null, coalesced: 246, purged: 357, staleFills: 468, "cdn-waiter-capacity": null } },
      other: { cpu: null, memory: null, health: ResourceHealth.HEALTHY, cache: { version: 1, hits: 99999, misses: null, expirations: null, evictions: null, coalescedWaiters: null } },
    } });
    initial.metrics = useSimulationStore.getState().metrics;
    for (const [type, label, value] of [["Database", "Serving queries", "321"], ["Cache", "Cache hits", "123"], ["CDN", "CDN hits", "234"]] as const) {
      const html = render(type);
      expect(html).toContain(`<dt>${label}</dt><dd>${value}</dd>`);
      expect(html).not.toContain("99999");
      expect(html).toContain("<dd>Unknown</dd>"); expect(html).toContain("<dd>0</dd>");
      expect(html).not.toMatch(/provider|exactly.once|hit rate/i);
    }
    expect(render("Database")).not.toContain("Cache hits"); expect(render("Cache")).not.toContain("CDN hits"); expect(render("Virtual Machine")).not.toContain("Serving queries");
    Reflect.deleteProperty(initial.metrics.selected!.cache!, "hits");
    expect(render("Cache")).toContain("<dt>Cache hits</dt><dd>Unknown</dd>");
    expect(render("Cache", "other")).toContain("<dt>Cache hits</dt><dd>99999</dd>");
  } finally { initial.metrics = previous; useSimulationStore.getState().reset(); }
});
