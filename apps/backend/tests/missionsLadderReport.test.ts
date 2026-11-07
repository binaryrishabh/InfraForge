import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { preflight } from "../challenges/preflight";
import { buildRunReport } from "../reports/report";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

test("mission ladder: real saved reports expose both mechanisms, one-failure near miss and missing evidence", async () => {
  const d = definition("open-and-size-an-api"), reference = REFERENCE[d.id]!, policyOnly = structuredClone(reference);
  delete policyOnly.resources.find(r => r.id === "app")!.skuId;
  const reports = [d.starter!, policyOnly, reference, REFERENCE[`${d.id}-headroom`]!].map(s => buildRunReport(attemptRow(d, s, answers(d, {"overall-health": "healthy"}))));
  const legacy = attemptRow(d, reference, answers(d, {"overall-health": "healthy"}));
  const snapshot = legacy.terminalSnapshot as {metrics: Record<string, {security?: unknown}>; traffic: {wholeRun?: unknown}};
  delete snapshot.metrics.fw!.security; delete snapshot.traffic.wholeRun;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import {createElement as h} from "react";
    import {renderToStaticMarkup as render} from "react-dom/server";
    import {MemoryRouter} from "react-router-dom";
    import {ChallengeDebrief} from "./src/features/challenges/components/ChallengeDebrief";
    import {RequirementList} from "./src/features/challenges/components/RequirementList";
    import {ReportMeasurements} from "./src/features/reports/components/ReportMeasurements";
    const {reports,legacy,criteria,checks} = await Bun.stdin.json();
    const debrief = r => render(h(MemoryRouter,null,h(ChallengeDebrief,{evaluation:r.challenge,brief:null})));
    console.log(JSON.stringify({requirements:render(h(RequirementList,{criteria,checks})),
      reports:reports.map(r=>({debrief:debrief(r),measurements:render(h(ReportMeasurements,{report:r,number:1}))})),
      legacy:{debrief:debrief(legacy),measurements:render(h(ReportMeasurements,{report:legacy,number:1}))}}));
  `], {cwd: resolve(import.meta.dir, "../../web"), stdin: "pipe", stdout: "pipe", stderr: "pipe"});
  child.stdin.write(JSON.stringify({reports, legacy: buildRunReport(legacy), criteria: d.criteria, checks: preflight(d, d.starter!).checks})); child.stdin.end();
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (await child.exited !== 0) throw Error(stderr);
  const html = JSON.parse(stdout) as {requirements: string; reports: Array<{debrief: string; measurements: string}>; legacy: {debrief: string; measurements: string}};
  expect(html.requirements.match(/<li /g)).toHaveLength(3);
  for (const c of d.criteria) expect(html.requirements).toContain(c.label);
  for (const [i, r] of reports.entries()) {
    for (const c of r.challenge!.criteria) expect(html.reports[i]!.debrief).toContain(c.detail);
    for (const label of ["Whole run", "CPU", "Policy denied new admissions", "Tracked state admissions", "Flow capacity refusals", "Monthly estimate (CostEstimate gate)"]) expect(html.reports[i]!.measurements).toContain(label);
  }
  expect(html.reports[0]!.measurements).toContain("fw:ingress:quarantine-db");
  expect(html.reports[1]!.debrief).toContain("2 of 3 met");
  expect(html.reports[1]!.debrief).toContain("1998 completed"); expect(html.reports[1]!.debrief).toContain("116 failed");
  expect(html.reports[1]!.measurements).toContain("100.0%");
  for (const i of [2, 3]) { expect(html.reports[i]!.debrief).toContain("3 of 3 met"); expect(html.reports[i]!.debrief).toContain("2399 completed"); }
  expect(html.reports[2]!.measurements).toContain("60.0%"); expect(html.reports[2]!.measurements).toContain("$216.90");
  expect(html.reports[3]!.measurements).toContain("30.0%"); expect(html.reports[3]!.measurements).toContain("$278.95");
  expect(html.legacy.debrief).toContain("absent refusals are Unknown");
  expect(html.legacy.debrief).toContain("Current cumulative caller outcomes through the evaluation second are required.");
  expect(html.legacy.debrief).not.toContain("0 completed (minimum");
  expect(html.legacy.measurements).toContain("Unknown");
}, 60000);

test("mission ladder: named designer controls support both edits, undo, redo and layout reload", async () => {
  const d = definition("open-and-size-an-api"), reference = REFERENCE[d.id]!;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import {createElement as h} from "react";
    import {renderToStaticMarkup as render} from "react-dom/server";
    import {Inspector} from "./src/features/canvas/components/inspector/Inspector";
    import {updateResource} from "./src/features/canvas/actions";
    import {useCanvasStore} from "./src/features/canvas/store/canvasStore";
    import {undo,redo} from "./src/features/canvas/history";
    const {start,reference} = await Bun.stdin.json(), get=useCanvasStore.getState;
    get().loadLayout(start.resources,start.connectionLines,"mission-ladder","Mission");
    const html=id=>render(h(Inspector,{resource:get().resources.find(r=>r.id===id)}));
    const firewall=html("fw"),app=html("app");
    updateResource("fw",{firewallSettings:reference.resources.find(r=>r.id==="fw").firewallSettings});
    updateResource("app",{skuId:reference.resources.find(r=>r.id==="app").skuId});
    const changed=structuredClone(get().resources); undo();undo();const undone=structuredClone(get().resources);
    redo();redo();const redone=structuredClone(get().resources);
    get().loadLayout(JSON.parse(JSON.stringify(redone)),start.connectionLines,"mission-ladder","Mission");
    console.log(JSON.stringify({firewall,app,changed,undone,redone,reloaded:get().resources}));
  `], {cwd: resolve(import.meta.dir, "../../web"), stdin: "pipe", stdout: "pipe", stderr: "pipe"});
  child.stdin.write(JSON.stringify({start: d.starter!, reference})); child.stdin.end();
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (await child.exited !== 0) throw Error(stderr);
  const result = JSON.parse(stdout);
  for (const label of ["Firewall policy", "Priority", "quarantine-db", "allow-app-db"]) expect(result.firewall).toContain(label);
  for (const label of ["Instance size", "Provider", "AWS", "Generic", "c5.large", "c5.xlarge"]) expect(result.app).toContain(label);
  expect(result.changed).toEqual(reference.resources); expect(result.undone).toEqual(d.starter!.resources);
  expect(result.redone).toEqual(reference.resources); expect(result.reloaded).toEqual(reference.resources);
}, 30000);
