import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { RunReport } from "@infraforge/contracts/reports";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { ChallengeDebrief } from "../src/features/challenges/components/ChallengeDebrief";
import { lessonRunMeasurements } from "../src/features/learning/runSummaryData";

test("real saved startup lab reports render byte admission, separate readiness, prediction and generic verdicts", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/artifactAdmissionLab.fixture.ts")], {stdout: "pipe", stderr: "pipe"});
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (await child.exited !== 0) throw Error(stderr);
  const reports = JSON.parse(stdout) as RunReport[];
  for (const [i, report] of reports.entries()) {
    const html = renderToStaticMarkup(<ReportMeasurements report={report} number={1} />);
    const debrief = renderToStaticMarkup(<MemoryRouter><ChallengeDebrief evaluation={report.challenge!} brief={null} /></MemoryRouter>);
    for (const label of ["Artifact cache capacity (bytes)", "Required image layer bytes", "Artifact-ready time (us)", "Listener-ready time (us)", "LB-eligible replicas (current)"]) expect(html).toContain(label);
    expect(html).toContain(`Artifact cache capacity (bytes)</dt><dd class="if-num break-all">${i === 1 ? "4,096" : "256"}</dd>`);
    expect(html).toContain('Required image layer bytes</dt><dd class="if-num break-all">1,024</dd>');
    expect(html).toContain('Artifact-ready time (us)</dt><dd class="if-num break-all">Unknown</dd>'); // Initial already deployed replica.
    if (i === 1) {
      expect(html).toContain('Listener-ready time (us)</dt><dd class="if-num break-all">12,001,071</dd>');
      expect(html).toContain('Artifact-ready time (us)</dt><dd class="if-num break-all">11,001,071</dd>');
      expect(debrief).toContain("Every requirement was met.");
    } else {
      expect(html).toContain("node-blob-cache-capacity");
      expect(debrief).toContain("Not every requirement was met.");
    }
    for (const criterion of report.challenge!.criteria) expect(debrief).toContain(criterion.detail);
    const summary = lessonRunMeasurements(report, ["Artifact cache capacity (bytes)", "Required image layer bytes", "Listener-ready time (us)"]);
    expect(summary[0]!.value).toContain(`app / app#1/image: ${i === 1 ? "4096" : "256"}`);
    expect(summary[1]!.value).toContain("1024");
  }
  expect(reports[1]!.run.learning!.hypothesis).toContain("Diagnosis:");
}, 120000);
