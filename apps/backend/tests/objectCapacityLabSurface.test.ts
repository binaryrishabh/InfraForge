import { expect, test } from "bun:test";
import { resolve } from "node:path";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { buildRunReport } from "../reports/report";
import { findLearningLesson, LEARNING_REGISTRY } from "../learning/registry";
import { checkLessonClaims } from "../learning/claims";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { specHash } from "../challenges/registry";
import { preflight } from "../challenges/preflight";
import { definition, REFERENCE, answers, attemptRow } from "./challengeHarness";

test("object capacity lesson uses the reviewed lab and existing report labels", () => {
  const d = definition("object-bytes-versus-app-cpu"), lesson = findLearningLesson(d.id)!;
  expect(lesson).toMatchObject({kind: "executable-lab", trackId: "data", moduleId: "object-capacity", experiment: {challengeId: d.id}, check: null});
  expect(checkLessonClaims(lesson, d)).toEqual([]);
  expect(LEARNING_REGISTRY.findModule("data", "object-capacity")!.lessonIds).toEqual([d.id]);
  expect(REVIEWED_CHALLENGES[`${lesson.id}@${lesson.contentVersion}`]).toEqual({challengeId: d.id, version: 1, hash: specHash(d)});
  expect(lesson.limitations.join(" ")).toContain("educational model outputs");
  expect(lesson.limitations.join(" ")).toContain("no real object-store API, physical durability or provider pricing");
});

test("object capacity control survives update, undo and reload; real saved reports render caller and queue populations separately", async () => {
  const d = definition("object-bytes-versus-app-cpu"), start = d.starter!, fixed = REFERENCE[d.id]!;
  const rows = [start, fixed].map(s => attemptRow(d, s, answers(d, {"overall-health": "critical"})));
  const reports = rows.map(row => buildRunReport({...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot))}));
  const missing = structuredClone(rows[1]!); delete (missing.terminalSnapshot as SimulationSnapshot).metrics.store!.objectStorage;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import {createElement as h} from "react";
    import {renderToStaticMarkup as render} from "react-dom/server";
    import {MemoryRouter} from "react-router-dom";
    import {Inspector} from "./src/features/canvas/components/inspector/Inspector";
    import {updateResource} from "./src/features/canvas/actions";
    import {useCanvasStore} from "./src/features/canvas/store/canvasStore";
    import {undo,redo} from "./src/features/canvas/history";
    import {RequirementList} from "./src/features/challenges/components/RequirementList";
    import {ChallengeDebrief} from "./src/features/challenges/components/ChallengeDebrief";
    import {ReportMeasurements} from "./src/features/reports/components/ReportMeasurements";
    const {start,patch,reports,missing,criteria,checks} = await Bun.stdin.json(),get=useCanvasStore.getState;
    get().loadLayout(start.resources,start.connectionLines,"object-lab","Objects");
    const inspector=render(h(Inspector,{resource:get().resources.find(r=>r.id==="store")}));
    updateResource("store",patch); const changed=structuredClone(get().resources);
    undo(); const undone=structuredClone(get().resources); redo(); const redone=structuredClone(get().resources);
    get().loadLayout(JSON.parse(JSON.stringify(redone)),start.connectionLines,"object-lab","Objects");
    const measurements = report => render(h(ReportMeasurements,{report,number:1}));
    console.log(JSON.stringify({inspector,changed,undone,redone,reloaded:get().resources,
      requirements:render(h(RequirementList,{criteria,checks})),
      reports:reports.map(report=>({measurements:measurements(report),debrief:render(h(MemoryRouter,null,h(ChallengeDebrief,{evaluation:report.challenge,brief:null})))})),
      missing:measurements(missing)}));
  `], {cwd: resolve(import.meta.dir, "../../web"), stdin: "pipe", stdout: "pipe", stderr: "pipe"});
  child.stdin.write(JSON.stringify({start, patch: {objectStoragePolicy: fixed.resources.find(r => r.id === "store")!.objectStoragePolicy},
    reports, missing: buildRunReport(missing), criteria: d.criteria, checks: preflight(d, start).checks})); child.stdin.end();
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (await child.exited !== 0) throw Error(stderr);
  const result = JSON.parse(stdout);
  expect(result.changed).toEqual(fixed.resources); expect(result.undone).toEqual(start.resources);
  expect(result.redone).toEqual(fixed.resources); expect(result.reloaded).toEqual(fixed.resources);
  expect(result.inspector).toContain("Stored data capacity (MiB)");
  expect(result.inspector).toMatch(/type="number"[^>]*value="1"/);
  for (const c of d.criteria) expect(result.requirements).toContain(c.label);
  for (const [i, report] of reports.entries()) {
    for (const c of report.challenge!.criteria) expect(result.reports[i].debrief).toContain(c.detail);
    const html = result.reports[i].measurements;
    for (const label of ["Puts reaching capacity check (cumulative)", "Object committed puts (cumulative)", "Acknowledged messages", "Ready messages"]) expect(html).toContain(label);
    expect(html).toContain("14.4%");
  }
  expect(result.reports[0].debrief).toContain("723 completed"); expect(result.reports[0].debrief).toContain("477 unsuccessful");
  expect(result.reports[1].debrief).toContain("1200 completed"); expect(result.reports[1].debrief).toContain("0 unsuccessful");
  expect(result.reports[1].measurements).toMatch(/Acknowledged messages<\/dt><dd>499<\/dd>/);
  expect(result.reports[1].measurements).toMatch(/Ready messages<\/dt><dd>700<\/dd>/);
  expect(result.reports[0].measurements).toMatch(/Object capacity refusals \(cumulative\)<\/dt><dd[^>]*>676<\/dd>/);
  expect(result.reports[1].measurements).toMatch(/Object capacity refusals \(cumulative\)<\/dt><dd[^>]*>Unknown<\/dd>/);
  expect(result.missing).toMatch(/Object stored bytes \(current\)<\/dt><dd[^>]*>Unknown<\/dd>/);
}, 120000);
