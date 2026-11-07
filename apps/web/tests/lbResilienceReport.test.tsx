import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunReport } from "@infraforge/contracts/reports";
import { LEARNING_REPORT_MEASUREMENTS } from "@infraforge/contracts/learning";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { lessonRunMeasurements } from "../src/features/learning/runSummaryData";

const render = (report: RunReport) => renderToStaticMarkup(<ReportMeasurements report={report} number={3} />);
const retryLabels = Object.entries(LEARNING_REPORT_MEASUREMENTS).filter(([,m]) => m.path.startsWith("lbRetry.")).map(([label]) => label);
const circuitLabels = Object.entries(LEARNING_REPORT_MEASUREMENTS).filter(([,m]) => m.path.startsWith("circuitBreaker.")).map(([label]) => label);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("actual saved engine reports render exact retry and per-path circuit populations; old and missing evidence stays Unknown", async () => {
  const process = Bun.spawn([Bun.which("bun")!, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/lbResilienceReport.fixture.ts")], {stdout: "pipe", stderr: "pipe"});
  const output = await new Response(process.stdout).text(), diagnostics = await new Response(process.stderr).text();
  expect(await process.exited, diagnostics).toBe(0);
  const {reports, oldRetry, oldCircuit, malformed, checkpointOnly} = JSON.parse(output) as {
    reports: RunReport[]; oldRetry: RunReport; oldCircuit: RunReport; malformed: RunReport; checkpointOnly: RunReport;
  };
  for (const report of reports) {
    const html = render(report), lb = report.terminal!.resources.find(r => r.id === "lb")!;
    expect(html).toContain('aria-label="Retry and circuit measurements for lb"');
    expect(html).toContain("not the final second");
    expect(html).toContain("Current gauges describe that instant only");
    const verify = (label: string, value: unknown) => {
      const text = value == null ? "Unknown" : typeof value === "boolean" ? value ? "Yes" : "No" : typeof value === "number" ? value.toLocaleString() : String(value);
      expect(html).toMatch(new RegExp(`${escape(label)}<\/dt><dd[^>]*>${escape(text)}<`));
    };
    const summary = lessonRunMeasurements(report, [...retryLabels, ...circuitLabels]);
    for (const label of retryLabels) {
      const path = LEARNING_REPORT_MEASUREMENTS[label as keyof typeof LEARNING_REPORT_MEASUREMENTS].path.split(".").slice(1);
      let value: unknown = lb.lbRetry;
      for (const key of path) value = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
      verify(label, value);
      expect(summary.find(r => r.label === label)!.value).toBe(`lb: ${value == null ? "Unknown" : `${value}${label === "Retry sample time (us)" ? " us" : ""}`}`);
    }
    if (lb.circuitBreaker) {
      verify("Circuit sample time (us)", lb.circuitBreaker.sampledAtUs);
      for (const p of lb.circuitBreaker.paths) {
        expect(html).toContain(p.id); expect(html).toContain(p.source); expect(html).toContain(p.target);
        for (const label of circuitLabels.filter(l => !["Circuit sample time (us)", "Circuit transitions (cumulative edges)"].includes(l))) {
          let value: unknown = p;
          for (const key of LEARNING_REPORT_MEASUREMENTS[label as keyof typeof LEARNING_REPORT_MEASUREMENTS].path.split(".").slice(3)) value = (value as Record<string, unknown>)[key];
          verify(label, value);
        }
        for (const [edge, value] of Object.entries(p.transitions)) verify(edge.replace(">", "&gt;"), value);
        expect(summary.find(r => r.label === "Circuit state (current)")!.value).toContain(`lb / ${p.id}: ${p.state}`);
        expect(summary.find(r => r.label === "Probe in flight (current)")!.value).toContain(`lb / ${p.id}: ${p.probeInFlight ? "Yes" : "No"}`);
      }
    } else expect(html).toContain("Circuit paths: Unknown");
  }
  for (const label of retryLabels) expect(render(oldRetry)).toMatch(new RegExp(`${escape(label)}<\/dt><dd[^>]*>Unknown<`));
  expect(lessonRunMeasurements(oldRetry, retryLabels).every(r => r.value === "lb: Unknown")).toBe(true);
  expect(render(oldCircuit)).toContain("Circuit paths: Unknown");
  expect(lessonRunMeasurements(oldCircuit, circuitLabels).every(r => r.value === "lb: Unknown")).toBe(true);
  expect(malformed.terminal).toBeNull();
  expect(lessonRunMeasurements(malformed, retryLabels).every(r => r.value === "lb: Unknown")).toBe(true);
  expect(checkpointOnly.terminal).toBeNull(); expect(render(checkpointOnly)).toContain("Latest retained simulation checkpoint");
  expect(render(checkpointOnly)).toContain("Reserved backoffs (current calls)");
  expect(lessonRunMeasurements(checkpointOnly, retryLabels).every(r => r.value === "lb: Unknown")).toBe(true);
}, 60000);
