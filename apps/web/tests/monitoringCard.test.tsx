import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MonitoringDashboardCard } from "../src/features/monitoring/components/MonitoringDashboardCard";

test("does not present healthy status or zero measurements before a live snapshot", () => {
  const html = renderToStaticMarkup(<MonitoringDashboardCard resource={{ id: "waiting-vm", type: "Virtual Machine", x: 0, y: 0 }} />);
  expect(html).toContain("Waiting for simulator telemetry");
  expect(html).not.toContain("healthy");
  expect(html).not.toContain("CPU");
  expect(html).not.toContain("rps");
});
