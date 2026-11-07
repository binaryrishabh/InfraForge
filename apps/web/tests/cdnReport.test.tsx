import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunReport } from "@infraforge/contracts/reports";
import { LEARNING_REPORT_MEASUREMENTS } from "@infraforge/contracts/learning";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { lessonRunMeasurements } from "../src/features/learning/runSummaryData";
import { ChallengeDebrief } from "../src/features/challenges/components/ChallengeDebrief";
import { MemoryRouter } from "react-router-dom";
import type { LearningLesson } from "@infraforge/contracts/learning";

const render = (report: RunReport) => renderToStaticMarkup(<ReportMeasurements report={report} number={3} />);
test("real saved CDN reports render audited counts, windows and Unknowns", async () => {
  const child = Bun.spawn([Bun.which("bun")!, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/cdnReport.fixture.ts")], {stdout: "pipe", stderr: "pipe"});
  const [output, errors] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(await child.exited, errors).toBe(0);
  const f = JSON.parse(output) as {cases: Array<{report: RunReport}>; missing: RunReport; unknown: RunReport; invalid: RunReport[]; inventedRefusal: RunReport; checkpointOnly: RunReport};
  const labels = Object.keys(LEARNING_REPORT_MEASUREMENTS).filter(l => l.startsWith("CDN:"));
  for (const {report} of f.cases) {
    const html = render(report), cdn = report.terminal!.resources.find(r => r.cdn)!.cdn!;
    expect(html).toContain("cumulative from run start through this snapshot");
    expect(html).toContain("All values are counts"); expect(html).toContain("Purge epochs: Unknown");
    expect(html).toContain("their waiters can still receive those replies");
    for (const label of labels) {
      const measurement = LEARNING_REPORT_MEASUREMENTS[label as keyof typeof LEARNING_REPORT_MEASUREMENTS];
      const key = measurement.path.split(".")[1]! as keyof typeof cdn;
      const value = cdn[key] == null ? "Unknown" : String(cdn[key]);
      expect(html).toContain(`<dt>${label}</dt><dd>${value}</dd>`);
      expect(lessonRunMeasurements(report, [label])[0]!.value).toContain(value);
    }
  }
  for (const label of labels) expect(render(f.missing)).toContain(`<dt>${label}</dt><dd>Unknown</dd>`);
  expect(lessonRunMeasurements(f.missing, labels).every(r => /Unknown/.test(r.value))).toBe(true);
  expect(render(f.unknown)).toContain("<dt>CDN: Hits</dt><dd>Unknown</dd>");
  for (const invalid of [...f.invalid, f.inventedRefusal]) expect(invalid.terminal).toBeNull();
  expect(render(f.checkpointOnly)).toContain("Latest retained simulation checkpoint");
  expect(lessonRunMeasurements(f.checkpointOnly, labels).every(r => /Unknown/.test(r.value))).toBe(true);
});

test("the first CDN lesson cites rendered real reports and generic caller requirements", async () => {
  const child = Bun.spawn([Bun.which("bun")!, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/cdnLab.fixture.ts")], {stdout: "pipe", stderr: "pipe"});
  const [output, errors] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(await child.exited, errors).toBe(0);
  const f = JSON.parse(output) as {lesson: LearningLesson; reports: RunReport[]};
  expect(f.reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  for (const report of f.reports) {
    const html = render(report);
    const values = lessonRunMeasurements(report, f.lesson.experiment!.evidenceToInspect!);
    expect(values.every(row => !/Unknown/.test(row.value))).toBe(true);
    for (const item of f.lesson.experiment!.evidenceToInspect!) for (const label of item.split(";").map(l => l.trim())) expect(html).toContain(label.replace("Whole run: ", ""));
    const requirements = renderToStaticMarkup(<MemoryRouter><ChallengeDebrief evaluation={report.challenge!} brief={null} /></MemoryRouter>);
    expect(requirements).toContain("Complete 60 callers without unsuccessful callers through second 32");
    for (const c of report.challenge!.criteria) expect(requirements).toContain(c.detail);
    expect(html).toContain("CDN: Waiter capacity refusals</dt><dd>Unknown</dd>");
  }
  const fixed = f.reports[1]!, html = render(fixed);
  expect(html).toContain("<dt>CDN: Hits</dt><dd>63</dd>");
  expect(html).toContain("<dt>CDN: Origin requests</dt><dd>1</dd>");
  expect(lessonRunMeasurements(fixed, ["Whole run: Completed"])[0]!.value).toContain("64");
});
