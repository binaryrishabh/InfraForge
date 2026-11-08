import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { RunReport } from "@infraforge/contracts/reports";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { ChallengeDebrief } from "../src/features/challenges/components/ChallengeDebrief";
import { lessonRunMeasurements } from "../src/features/learning/runSummaryData";
test("real saved pool lab reports render path wait, sessions, refusals and caller outcomes; absent measurements stay Unknown", async () => {
 const code = `import {definition,REFERENCE,attemptRow,answers} from './apps/backend/tests/challengeHarness';
 import {buildRunReport} from './apps/backend/reports/report';
 const d=definition('size-the-app-database-pool');
 console.log(JSON.stringify([d.starter,REFERENCE[d.id]].map(s=>buildRunReport(attemptRow(d,s,answers(d,{'database-health':'healthy'}))))));`;
 const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", code], {cwd: resolve(import.meta.dir, "../../.."), stdout: "pipe", stderr: "pipe"});
 const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
 expect(await child.exited, err).toBe(0); const reports = JSON.parse(out) as RunReport[];
 expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met"]);
 const render = (report: RunReport) => renderToStaticMarkup(<ReportMeasurements report={report} number={3} />);
 for (const r of reports) {
  const html = render(r), t = r.terminal!, path = t.durationEvidence!.paths.find(p => p.target === "db")!;
  expect(html).toContain(`Duration: Acquired pool wait</dt><dd>${path.reachedPhaseUs.connectionWaitUs}</dd>`);
  expect(html).toContain(`Pending acquisitions (count)</dt><dd>${path.pendingAcquisitions}</dd>`);
  expect(html).toContain(path.id); expect(html).toContain("Refused session opens</dt><dd>0</dd>");
  expect(html).toContain("unfinished acquisition is Unknown"); expect(html).toContain("<th"); expect(html).toContain("Connections");
  const summary = lessonRunMeasurements(r, ["Duration: Acquired pool wait"])[0]!;
  expect(summary.value).toContain(`${path.id}: ${path.reachedPhaseUs.connectionWaitUs} us`);
  const requirements = renderToStaticMarkup(<MemoryRouter><ChallengeDebrief evaluation={r.challenge!} brief={null} /></MemoryRouter>);
  for (const c of r.challenge!.criteria) { expect(requirements).toContain(c.label); expect(requirements).toContain(c.detail); }
 }
 const old = structuredClone(reports[1]!); delete old.terminal!.durationEvidence;
 delete old.terminal!.resources.find(r => r.id === "db")!.database;
 expect(render(old)).toContain("Duration: Acquired pool wait</dt><dd>Unknown</dd>");
 expect(render(old)).toContain("Refused session opens</dt><dd>Unknown</dd>");
 expect(lessonRunMeasurements(old, ["Duration: Acquired pool wait"])[0]!.value).toBe("Unknown");
}, 120000);
