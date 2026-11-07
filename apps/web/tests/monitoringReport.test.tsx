import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunReport } from "@infraforge/contracts/reports";
import { LEARNING_REPORT_MEASUREMENTS } from "@infraforge/contracts/learning";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { lessonRunMeasurements } from "../src/features/learning/runSummaryData";

const render = (r: RunReport) => renderToStaticMarkup(<ReportMeasurements report={r} number={3} />);
test("real monitoring reports render each audited owner reading, null freshness and historical absence", async () => {
  const child = Bun.spawn([Bun.which("bun")!, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/monitoringReport.fixture.ts")], {stdout: "pipe", stderr: "pipe"});
  const [output, errors] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(await child.exited, errors).toBe(0);
  const f = JSON.parse(output) as {cases: Array<{mode: string; report: RunReport}>; missing: RunReport; unknown: RunReport; nullAge: RunReport; invalid: RunReport[]; checkpointOnly: RunReport};
  const labels = Object.entries(LEARNING_REPORT_MEASUREMENTS).filter(([label]) => label.startsWith("Monitoring"));
  for (const {report} of f.cases) {
    const html = render(report), resource = report.terminal!.resources.find(r => r.id === "monitor")!;
    expect(html).toContain("cumulative from run start through this snapshot");
    expect(html).toContain("simulated microseconds");
    expect(html).toContain("the backend may already have received those samples");
    expect(html).toContain("including duplicates; refusals count batches");
    for (const [label, d] of labels) {
      const path = d.path.split(".");
      const block = resource[path[0] as "monitoring" | "monitoringBackend"]!;
      const field = (block as unknown as Record<string, unknown>)[path[1]!] as unknown;
      const values = path[2] === "*" ? Array.isArray(field) && field.length ? field.map(row => row[path[3]!]) : [null] : [field];
      for (const raw of values) {
        const value = raw == null ? "Unknown" : String(raw);
        expect(html).toContain(`<dt>${label}</dt><dd>${value}</dd>`);
        expect(lessonRunMeasurements(report, [label])[0]!.value).toContain(value);
      }
    }
  }
  const noResource = structuredClone(f.missing);
  noResource.terminal!.resources = [];
  for (const [label] of labels) expect(render(noResource)).toContain(`<dt>${label}</dt><dd>Unknown</dd>`);
  const multiple = f.cases.find(c => c.mode === "multiple")!.report;
  expect(lessonRunMeasurements(multiple, ["Monitoring: Collection age"])[0]!.value).toContain("monitor / vm:");
  expect(lessonRunMeasurements(multiple, ["Monitoring: Collection age"])[0]!.value).toContain("monitor / db:");
  for (const [label] of labels) expect(render(f.missing)).toContain(`<dt>${label}</dt><dd>Unknown</dd>`);
  expect(lessonRunMeasurements(f.missing, labels.map(([label]) => label)).every(r => /Unknown/.test(r.value))).toBe(true);
  for (const label of ["Monitoring: Collection age", "Monitoring backend: Measurement age"]) expect(render(f.nullAge)).toContain(`<dt>${label}</dt><dd>Unknown</dd>`);
  expect(render(f.unknown)).toContain("<dt>Monitoring: Generated samples</dt><dd>Unknown</dd>");
  expect(render(f.unknown)).toContain("<dt>Monitoring backend: Received samples</dt><dd>Unknown</dd>");
  const noCollection = f.cases.find(c => c.mode === "no-collection")!.report;
  expect(render(noCollection)).toContain("<dt>Monitoring: Generated samples</dt><dd>0</dd>");
  expect(render(noCollection)).toContain("<dt>Monitoring: Collection age</dt><dd>Unknown</dd>");
  expect(render(noCollection)).toContain("<dt>Monitoring backend: Measurement age</dt><dd>Unknown</dd>");
  expect(render(f.checkpointOnly)).toContain("Latest retained simulation checkpoint");
  expect(lessonRunMeasurements(f.checkpointOnly, labels.map(([label]) => label)).every(r => /Unknown/.test(r.value))).toBe(true);
  for (const r of f.invalid) expect(r.terminal).toBeNull();
});
