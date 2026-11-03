import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TrafficEvidence } from "../src/features/live/TrafficEvidence";
import { TrafficReadings } from "../src/features/live/TrafficReadings";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";

test("shared traffic presentation uses its props and preserves the live markup", () => {
  const initial = useSimulationStore.getInitialState(), previous = initial.traffic;
  const traffic = { offeredRps: 103, completedRps: 100, failedRps: 3, latencyMs: { p50: 2, p95: 8, p99: 13 } };
  try {
    initial.traffic = traffic;
    expect(renderToStaticMarkup(<TrafficEvidence traffic={traffic} />)).toBe(renderToStaticMarkup(<TrafficReadings />));
    initial.traffic = undefined;
    expect(renderToStaticMarkup(<TrafficEvidence traffic={traffic} />)).toContain("13 ms");
    expect(renderToStaticMarkup(<TrafficEvidence />).match(/<dd>Unknown<\/dd>/g)).toHaveLength(6);
  } finally { initial.traffic = previous; }
});
