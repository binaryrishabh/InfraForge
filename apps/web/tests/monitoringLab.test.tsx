import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ChallengeCriterion } from "@infraforge/contracts/challenges";
import type { RunReport } from "@infraforge/contracts/reports";
import type { Resource } from "@infraforge/domain/resource";
import { RequirementList } from "../src/features/challenges/components/RequirementList";
import { ChallengeDebrief } from "../src/features/challenges/components/ChallengeDebrief";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";

test("real monitoring lab reports render through generic requirement rows and existing measurements; actual inspector exposes the batch control", async () => {
  const code=`import {monitoringLabFixture} from './apps/backend/tests/monitoringLab.fixture';
    import {buildRunReport} from './apps/backend/reports/report';
    const f=monitoringLabFixture();const bad=structuredClone(f.rows[1]);bad.terminalSnapshot.metrics.monitor.monitoringBackend.latest[0].ageUs=null;
    console.log(JSON.stringify({criteria:f.d.criteria,monitor:f.designs[0].resources.find(r=>r.id==='monitor'),reports:[...f.rows,bad].map(r=>buildRunReport(r))}));`;
  const child=Bun.spawn([process.execPath,"--no-env-file","--eval",code],{cwd:resolve(import.meta.dir,"../../.."),stdout:"pipe",stderr:"pipe"});
  const [out,err]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text()]);
  expect(await child.exited,err).toBe(0);
  const {criteria,monitor,reports}=JSON.parse(out) as {criteria:ChallengeCriterion[];monitor:Resource;reports:RunReport[]};
  expect(reports.map(r=>r.challenge!.status)).toEqual(["not-met","met","not-met","not-evaluated"]);
  const brief=renderToStaticMarkup(<RequirementList criteria={criteria} />);
  for(const c of criteria) expect(brief).toContain(c.label);
  for(const report of reports) {
    const html=renderToStaticMarkup(<MemoryRouter><ChallengeDebrief brief={null} evaluation={report.challenge!}/></MemoryRouter>);
    for(const c of report.challenge!.criteria) {expect(html).toContain(c.label);expect(html).toContain(c.detail);}
    const measurements=renderToStaticMarkup(<ReportMeasurements report={report} number={3}/>);
    for(const label of ["Monitoring: Generated samples","Monitoring backend: Received samples","Monitoring backend: Duplicate samples","Monitoring backend: Measurement age"]) expect(measurements).toContain(label);
  }
  const unknown=renderToStaticMarkup(<ReportMeasurements report={reports[3]!} number={3}/>);
  expect(unknown).toContain("Monitoring backend: Measurement age</dt><dd>Unknown</dd>");
  const inspector=renderToStaticMarkup(<Inspector resource={monitor}/>);
  expect(inspector).toMatch(/<label[^>]*for="[^"]+"[^>]*>Export batch size<\/label>/);
  expect(inspector).toContain('value="1"');expect(inspector).toContain('max="64"');expect(inspector).toContain('type="number"');
});
