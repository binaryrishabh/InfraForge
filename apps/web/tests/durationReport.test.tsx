import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunReport } from "@infraforge/contracts/reports";
import { LEARNING_REPORT_MEASUREMENTS } from "@infraforge/contracts/learning";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { lessonRunMeasurements } from "../src/features/learning/runSummaryData";

test("real engine duration reports render owned phases, units, population limits and Unknown evidence", async () => {
  const child = Bun.spawn([Bun.which("bun")!, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/durationReport.fixture.ts")], {stdout: "pipe", stderr: "pipe"});
  const [output, errors] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(await child.exited, errors).toBe(0);
  const f = JSON.parse(output) as {reports: RunReport[]; finiteReports: RunReport[]; missing: RunReport; nullHold: RunReport; checkpointOnly: RunReport; invalid: RunReport; duplicate: RunReport};
  const render = (r: RunReport) => renderToStaticMarkup(<ReportMeasurements report={r} number={3} />);
  const labels = Object.entries(LEARNING_REPORT_MEASUREMENTS).filter(([label]) => label.startsWith("Duration:"));
  for (const report of [...f.reports, ...f.finiteReports]) {
    const html = render(report), e = (report.terminal ?? report.checkpoint)!.durationEvidence!;
    expect(html).toContain("simulated microseconds (us)"); expect(html).toContain("core-us");
    expect(html).toContain("Failed, cancelled and pending acquisitions have no measured wait duration");
    expect(html).toContain("Worker slot hold excludes buffered and acknowledgement-wait work");
    for (const [label, d] of labels) {
      const path = d.path.split(".");
      const items = path[1] === "resources" ? e.resources : path[1] === "paths" ? e.paths : null;
      const read = (input: unknown, keys: string[]): unknown => keys.reduce((v, key) => v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined, input);
      const raw = items ? items.map(item => read(item, path.slice(3))) : [read(e, path.slice(1))];
      for (const v of raw) {
        const value = v == null ? "Unknown" : String(v);
        expect(html).toContain(`<dt>${label}</dt><dd>${value}</dd>`);
        if (report.terminal) expect(lessonRunMeasurements(report, [label])[0]!.value).toContain(value);
      }
    }
    for (const p of e.paths) {
      expect(html).toContain(p.id); expect(html).toContain(p.source); expect(html).toContain(p.target);
      if (report.terminal) expect(lessonRunMeasurements(report, ["Duration: Acquired pool wait"])[0]!.value).toContain(`${p.id}: ${p.reachedPhaseUs.connectionWaitUs} us`);
    }
  }
  for (const [label] of labels) {
    expect(render(f.missing)).toContain(`<dt>${label}</dt><dd>Unknown</dd>`);
    expect(lessonRunMeasurements(f.missing, [label])[0]!.value).toBe("Unknown");
    expect(lessonRunMeasurements(f.checkpointOnly, [label])[0]!.value).toBe("Unknown");
  }
  expect(render(f.nullHold)).toContain("<dt>Duration: Slot hold</dt><dd>Unknown</dd>");
  expect(render(f.checkpointOnly)).toContain("Latest retained simulation checkpoint");
  expect(f.invalid.terminal).toBeNull(); expect(f.duplicate.terminal).toBeNull();
}, 180000);
