import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { preflight } from "../challenges/preflight";
import { buildRunReport } from "../reports/report";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

test("async reports show captured populations through generic requirements and subscriber readouts, including Unknown", async () => {
  const cases = ["keep-up-with-the-queue", "leave-time-to-acknowledge", "open-one-subscriber"].map(id => {
    const d = definition(id), checks = preflight(d, d.starter!).checks;
    return {criteria: d.criteria, checks, reports: [d.starter!, REFERENCE[id]!].map(design => buildRunReport(attemptRow(d, design, answers(d, {"overall-health": "healthy"}))))};
  });
  const d = definition("leave-time-to-acknowledge"), legacy = attemptRow(d, REFERENCE[d.id]!, answers(d, {"overall-health": "healthy"}));
  const snapshot = legacy.terminalSnapshot as {metrics: Record<string, {queueWork?: unknown}>}; delete snapshot.metrics.queue!.queueWork;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import {createElement as h} from "react";
    import {renderToStaticMarkup as render} from "react-dom/server";
    import {MemoryRouter} from "react-router-dom";
    import {ChallengeDebrief} from "./src/features/challenges/components/ChallengeDebrief";
    import {RequirementList} from "./src/features/challenges/components/RequirementList";
    import {ReportMeasurements} from "./src/features/reports/components/ReportMeasurements";
    const {cases,legacy} = await Bun.stdin.json();
    const debrief = report => render(h(MemoryRouter,null,h(ChallengeDebrief,{evaluation:report.challenge,brief:null})));
    console.log(JSON.stringify({cases:cases.map(c=>({requirements:render(h(RequirementList,{criteria:c.criteria,checks:c.checks})),
      reports:c.reports.map(r=>({debrief:debrief(r),measurements:render(h(ReportMeasurements,{report:r,number:1}))}))})),legacy:debrief(legacy)}));
  `], {cwd: resolve(import.meta.dir, "../../web"), stdin: "pipe", stdout: "pipe", stderr: "pipe"});
  child.stdin.write(JSON.stringify({cases, legacy: buildRunReport(legacy)})); child.stdin.end();
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (await child.exited !== 0) throw Error(stderr);
  const html = JSON.parse(stdout) as {cases: Array<{requirements: string; reports: Array<{debrief: string; measurements: string}>}>; legacy: string};
  for (const [i, c] of cases.entries()) {
    expect(html.cases[i]!.requirements.match(/<li /g)).toHaveLength(c.criteria.length);
    for (const criterion of c.criteria) expect(html.cases[i]!.requirements).toContain(criterion.label);
    for (const [j, report] of c.reports.entries()) for (const criterion of report.challenge!.criteria) expect(html.cases[i]!.reports[j]!.debrief).toContain(criterion.detail);
  }
  expect(html.cases[1]!.reports[0]!.debrief).toContain("3 originals, 7 deliveries, 7 completed object effects, 0 acknowledged");
  expect(html.cases[1]!.reports[1]!.debrief).toContain("3 originals, 3 deliveries, 3 completed object effects, 3 acknowledged");
  expect(html.cases[2]!.reports[0]!.measurements).toContain("bus-queue");
  expect(html.cases[2]!.reports[0]!.measurements).toContain("72");
  expect(html.legacy).toContain("Complete queue work counters through the evaluation second were not recorded.");
  expect(html.legacy).not.toContain("0 originals");
}, 120000);

test("all three reference settings are exposed in the existing inspector and survive update, undo and reload", async () => {
  const ids = ["keep-up-with-the-queue", "leave-time-to-acknowledge", "open-one-subscriber"];
  const cases = ids.map((id, i) => ({start: definition(id).starter!, resourceId: i === 0 ? "worker" : "queue",
    patch: i === 0 ? {asyncWorker: REFERENCE[id]!.resources.find(r => r.id === "worker")!.asyncWorker}
      : i === 1 ? {asyncQueue: REFERENCE[id]!.resources.find(r => r.id === "queue")!.asyncQueue}
        : {listenerSettings: REFERENCE[id]!.resources.find(r => r.id === "queue")!.listenerSettings}}));
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import {createElement} from "react";
    import {renderToStaticMarkup} from "react-dom/server";
    import {Inspector} from "./src/features/canvas/components/inspector/Inspector";
    import {updateResource} from "./src/features/canvas/actions";
    import {useCanvasStore} from "./src/features/canvas/store/canvasStore";
    import {undo,redo} from "./src/features/canvas/history";
    const cases=await Bun.stdin.json(),get=useCanvasStore.getState;
    console.log(JSON.stringify(cases.map(({start,resourceId,patch})=>{
      get().loadLayout(start.resources,start.connectionLines,"async-lab","Async");
      const html=renderToStaticMarkup(createElement(Inspector,{resource:get().resources.find(r=>r.id===resourceId)}));
      updateResource(resourceId,patch); const changed=structuredClone(get().resources);
      undo();const undone=structuredClone(get().resources);redo();const redone=structuredClone(get().resources);
      get().loadLayout(JSON.parse(JSON.stringify(redone)),start.connectionLines,"async-lab","Async");
      return {html,changed,undone,redone,reloaded:get().resources};
    })));
  `], {cwd: resolve(import.meta.dir, "../../web"), stdin: "pipe", stdout: "pipe", stderr: "pipe"});
  child.stdin.write(JSON.stringify(cases)); child.stdin.end();
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (await child.exited !== 0) throw Error(stderr);
  const result = JSON.parse(stdout);
  for (const [i, id] of ids.entries()) {
    expect(result[i].changed).toEqual(REFERENCE[id]!.resources); expect(result[i].undone).toEqual(cases[i]!.start.resources);
    expect(result[i].redone).toEqual(result[i].changed); expect(result[i].reloaded).toEqual(result[i].changed);
    expect(result[i].html).toContain(["CPU milliseconds per job (authored assumption)", "Visibility timeout (seconds)", "TCP listener ports"][i]!);
  }
});
