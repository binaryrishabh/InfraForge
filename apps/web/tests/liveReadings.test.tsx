import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResourceHealth, type Resource } from "@infraforge/domain/resource";
import { NodeLive } from "../src/features/live/NodeLive";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";

const queue: Resource = { id: "queue", type: "Message Queue", x: 0, y: 0 };
const render = (resource = queue) => renderToStaticMarkup(<NodeLive deploymentId="run" resource={resource} resources={[resource]} controls={false} />);

test("selected live resource shows queue and security consequences from a snapshot", () => {
  const initial = useSimulationStore.getInitialState(), previous = initial.metrics;
  try {
    useSimulationStore.getState().prepareRun("run");
    useSimulationStore.getState().applySnapshot({
      deploymentId: "run", timestamp: "2026-10-31T00:00:00Z", simulatedSeconds: 3, loadFraction: 1, health: "healthy", logs: [],
      metrics: { queue: { cpu: null, memory: null, health: ResourceHealth.HEALTHY,
        asyncQueue: { version: 2, published: 20, completed: 4, readyDepth: 12, oldestReadyAgeSeconds: 2.5, inFlight: 4, redeliveries: 3, deadLettered: 1, failedAttempts: 5, deadLetterOverflowDiscards: 0, wastedCpuSeconds: 0.75 },
        security: { version: 1, evidence: "complete", firewall: { occupancy: 2, limit: 100, admissions: 7, generation: 1 },
          edges: [{ path: "app-db", source: "app", target: "db", admitted: 7, denied: 3, noListener: 2, backendDeliveries: 5,
            policyDenied: { "fw:ingress:block-db": 3 }, lastDenial: { connectionId: "connection-7", source: "app", target: "db", port: 5432, reason: "policy-denied:fw:ingress:block-db", generation: 1 } }] } } },
    });
    // Server rendering uses Zustand's hydration snapshot.
    initial.metrics = useSimulationStore.getState().metrics;
    const html = render();
    for (const [label, value] of [["Ready messages", "12"], ["Oldest ready message age (seconds)", "2.5"], ["In flight", "4"], ["Redeliveries", "3"], ["Dead-lettered", "1"], ["Failed attempts (worker nacks sent)", "5"], ["CPU seconds spent on failed attempts", "0.75"]]) {
      expect(html).toContain(`<dt>${label}</dt><dd>${value}</dd>`);
    }
    for (const text of ["denied opens 3", "no listener 2", "backend deliveries 5", "connection-7", "fw:ingress:block-db", "<dt>Current flow occupancy</dt><dd>2</dd>", "<dt>Configured flow limit</dt><dd>100</dd>"]) expect(html).toContain(text);
    expect(html).toContain("Unknown requests/s");
  } finally { initial.metrics = previous; useSimulationStore.getState().reset(); }
});

test("live enabled queue readings stay Unknown without measurements, including after the run ends", () => {
  const enabled = { ...queue, asyncQueue: { enabled: true } };
  const html = render(enabled);
  expect(html.match(/<dd>Unknown<\/dd>/g)).toHaveLength(10);
  const ended = renderToStaticMarkup(<NodeLive deploymentId="run" resource={enabled} resources={[enabled]} controls={false} ended />);
  expect(ended).toContain("This run has ended");
  expect(ended.match(/<dd>Unknown<\/dd>/g)).toHaveLength(10);
});

test("unconfigured resources omit irrelevant Unknown blocks, explicit security still shows Unknown", () => {
  expect(render()).not.toContain("Live upload journey");
  expect(render()).not.toContain("Security measurements: Unknown");
  const db: Resource = { id: "db", type: "Database", x: 0, y: 0 };
  expect(render(db)).not.toContain("Security measurements: Unknown");
  expect(render({ ...db, listenerSettings: { version: 1, ports: [5432] } })).toContain("Security measurements: Unknown");
  expect(render({ id: "fw", type: "Firewall", x: 0, y: 0 })).toContain("Security measurements: Unknown");
});
