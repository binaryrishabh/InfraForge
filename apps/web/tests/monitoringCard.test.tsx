import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NodeCard } from "../src/features/canvas/components/node/NodeCard";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";

afterEach(() => useSimulationStore.getState().reset());

test("a live card does not present healthy status or zero measurements before a snapshot", () => {
  const html = renderToStaticMarkup(<NodeCard mode="live" resource={{ id: "waiting-vm", type: "Virtual Machine", x: 0, y: 0 }} />);
  expect(html).toContain("Waiting for the first measurement");
  expect(html).not.toContain("Healthy");
  expect(html).not.toContain("CPU");
  expect(html).not.toContain("rps");
});

test("a design card shows declared capacity, size and exposure facts", () => {
  const html = renderToStaticMarkup(<NodeCard mode="design" resource={{ id: "edge", type: "Load Balancer", x: 0, y: 0, public: true, encryption: true, openPorts: [443] }} />);
  expect(html).toContain("generic");
  expect(html).toContain("public · encrypted · :443");
  expect(html).toContain("autoscaling · target 75% CPU");
});
