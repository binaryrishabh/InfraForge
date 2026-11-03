import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { ReportView } from "../src/features/reports/components/ReportView";
import { recordedTraffic, trafficReport } from "./reportTraffic.fixture";

const render = (report = trafficReport) => renderToStaticMarkup(<ReportMeasurements report={report} number={3} />);

test("report displays recorded traffic with honest windows and shared explanations", () => {
  const html = render();
  for (const text of ["Traffic outcomes", "Last measured second before the run stopped", "13 ms", "103", "100", "Client retry load",
    "Attempts/s: last measured second", "Counters and load factor: whole run", "Timed-out attempts", "30", "Wasted completions", "4",
    "Service objective: Missed", "Service objective: whole run", "450/500 (90%)", "455/500 (91%)", "Typical request", "Slowest 1%",
    "Latency composition: last measured second", "p99 = 99%", "Times are exclusive", "An educational objective"]) expect(html).toContain(text);
  expect(html.match(/p99 = 99%/g)).toHaveLength(1);
  expect(html).toContain("overflow-x-auto");
});

test("historical report omits traffic entirely and unknown samples never become zero", () => {
  const historical = render({ ...trafficReport, terminal: { resources: [] } });
  expect(historical).not.toContain("Traffic outcomes");
  expect(historical).not.toContain("Measured caller traffic");
  const unknown = render({ ...trafficReport, terminal: { resources: [], traffic: { ...recordedTraffic,
    latencyMs: { p50: null, p95: null }, clientRetry: undefined, objective: undefined, latency: undefined } } });
  expect(unknown.match(/<dd>Unknown<\/dd>/g)).toHaveLength(3);
  for (const text of ["Client retry load", "Service objective", "Where completed requests"]) expect(unknown).not.toContain(text);
});

test("diagnostic report never labels its measurements as the terminal second", () => {
  const html = render({ ...trafficReport, terminal: null, checkpoint: { ...trafficReport.terminal!, capturedAt: "2026-11-03T00:00:05.000Z" } });
  expect(html).toContain("Diagnostic checkpoint with a recorded capture time");
  expect(html).toContain("Last measured second at the retained diagnostic checkpoint");
  expect(html).toContain("From run start through this checkpoint");
  expect(html).not.toContain("before the run stopped");
  expect(html).not.toContain("whole run");
});

test("traffic stays inside the snapshot section without changing section numbering", () => {
  const html = renderToStaticMarkup(<MemoryRouter><ReportView report={trafficReport} /></MemoryRouter>);
  expect(html).toContain("Traffic outcomes");
  expect(html).toContain('03</span>Exact terminal simulation snapshot');
  expect(html).toContain('04</span>Lineage');
  expect(html).not.toContain('id="traffic-outcomes"');
});
