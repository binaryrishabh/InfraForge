import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { RunReport } from "@infraforge/contracts/reports";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { ChallengeDebrief } from "../src/features/challenges/components/ChallengeDebrief";

test("real beginner reports render scored requirements, queue depth and age, with honest missing observations", async () => {
  // Generate fresh server reports through the real harness without bundling backend code into the web app.
  const root = resolve(import.meta.dir, "../../..");
  const code = `import {definition, REFERENCE, attemptRow, answers} from './apps/backend/tests/challengeHarness';
    import {buildRunReport} from './apps/backend/reports/report';
    const reports=[]; for(const id of ['keep-waiting-work','check-the-missing-server']) {
      const d=definition(id); for(const s of [d.starter,REFERENCE[id]]) reports.push(buildRunReport(attemptRow(d,s,answers(d,{'overall-health':'healthy'}))));
    } console.log(JSON.stringify(reports));`;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", code], {cwd: root, stdout: "pipe", stderr: "pipe"});
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (await child.exited !== 0) throw Error(stderr);
  const reports = JSON.parse(stdout) as RunReport[];
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met", "met"]);
  for (const r of reports) {
    const html = renderToStaticMarkup(<ReportMeasurements report={r} number={3} />);
    const requirements = renderToStaticMarkup(<MemoryRouter><ChallengeDebrief evaluation={r.challenge!} brief={null} /></MemoryRouter>);
    for (const c of r.challenge!.criteria) { expect(requirements).toContain(c.label); expect(requirements).toContain(c.detail); }
    if (r.challenge!.challengeId === "keep-waiting-work") {
      const queue = r.terminal!.resources.find(m => m.id === "queue")!;
      for (const label of ["Acknowledged messages", "Expired messages", "Ready messages", "Oldest ready message age (seconds)"]) expect(html).toContain(label);
      expect(html).toContain(`<dd>${queue.queueWork!.acknowledged}</dd>`);
      expect(html).toContain(`<dd>${queue.queueWork!.expired}</dd>`);
      expect(html).toContain(`<dd>${queue.asyncQueue!.readyDepth}</dd>`);
      if (r.challenge!.status === "met") expect(html).toContain("10.996246");
      else expect(html).toContain("Unknown");
    } else { expect(html).toContain("Completed"); expect(html).toContain("Failed"); }
  }
  const passing = reports[1]!, resource = passing.terminal!.resources.find(m => m.id === "queue")!;
  delete resource.asyncQueue;
  let html = renderToStaticMarkup(<ReportMeasurements report={passing} number={3} />);
  expect(html).toContain("Oldest ready message age (seconds)</dt><dd>Unknown");
  delete resource.queueWork;
  html = renderToStaticMarkup(<ReportMeasurements report={passing} number={3} />);
  expect(html).not.toContain("queue measurements");
  expect(readFileSync(resolve(root, "apps/web/src/features/reports/components/ReportMeasurements.tsx"), "utf8")).toContain("<QueueReadings");
}, 120000);
