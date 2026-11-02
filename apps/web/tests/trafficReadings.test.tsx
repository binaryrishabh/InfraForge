import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TrafficReadings } from "../src/features/live/TrafficReadings";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";

test("traffic readings show real p99 and explain the completed-request window; missing samples remain Unknown", () => {
  const initial = useSimulationStore.getInitialState(), previous = initial.traffic;
  try {
    initial.traffic = { offeredRps: 101, completedRps: 100, failedRps: 1, latencyMs: { p50: 3, p95: 9, p99: 20 } };
    let html = renderToStaticMarkup(<TrafficReadings />);
    expect(html).toContain("p99"); expect(html).toContain("20 ms");
    expect(html).toContain("p99 = 99% of completed requests in this measured window were at or below this response time.");
    initial.traffic = undefined; html = renderToStaticMarkup(<TrafficReadings />);
    expect(html.match(/<dd>Unknown<\/dd>/g)).toHaveLength(6);
  } finally { initial.traffic = previous; }
});
