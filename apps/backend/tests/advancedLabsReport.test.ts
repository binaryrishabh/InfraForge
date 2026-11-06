import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { buildRunReport } from "../reports/report";
import { preflight } from "../challenges/preflight";
import { definition, REFERENCE, attemptRow, answers } from "./challengeHarness";

const ids = ["diagnose-lost-app-capacity", "investigate-a-pool-reset", "budget-for-a-partition", "trace-a-saturation-cascade"];

test("advanced retained reports render generic requirements, incident chronology, pressure and Unknown", async () => {
  const payload = ids.map(id => {
    const d = definition(id), row = attemptRow(d, d.starter!, answers(d, {"database-admission": "other-or-mixed", "busiest-type": "Virtual Machine", "overall-health": "healthy", "database-health": "healthy"}));
    return {report: buildRunReport(row), criteria: d.criteria, checks: preflight(d, d.starter!).checks};
  });
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import {createElement} from "react"; import {renderToStaticMarkup} from "react-dom/server";
    import {ReportMeasurements} from "./src/features/reports/components/ReportMeasurements";
    import {ActionTimeline} from "./src/features/reports/components/ActionTimeline";
    import {RequirementList} from "./src/features/challenges/components/RequirementList";
    const rows=await Bun.stdin.json(); console.log(JSON.stringify(rows.map(({report,criteria,checks})=>({
      measurements:renderToStaticMarkup(createElement(ReportMeasurements,{report,number:1})),
      actions:renderToStaticMarkup(createElement(ActionTimeline,{actions:report.actions})),
      requirements:renderToStaticMarkup(createElement(RequirementList,{criteria,checks}))}))));
  `], {cwd: resolve(import.meta.dir, "../../web"), stdin: "pipe", stdout: "pipe", stderr: "pipe"});
  child.stdin.write(JSON.stringify(payload)); child.stdin.end();
  const [out, errors] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]); if (await child.exited !== 0) throw Error(errors);
  const html = JSON.parse(out);
  for (const [i, p] of payload.entries()) {
    expect(html[i].requirements.match(/<li /g)).toHaveLength(p.criteria.length);
    for (const criterion of p.criteria) expect(html[i].requirements).toContain(criterion.label);
  }
  expect(html[0].measurements).toContain("Flow capacity refusals"); expect(html[0].measurements).toContain("Unknown");
  expect(html[1].actions).toContain("db-slowdown"); expect(html[1].actions).toContain("reset-pool");
  expect(html[1].actions).toContain("2000001 us"); expect(html[1].actions).toContain("5000001 us");
  expect(html[1].actions).toContain("one-shot"); expect(html[1].actions).toContain("downstream effects may remain");
  expect(html[2].actions).toContain("isolate-app"); expect(html[2].actions).toContain("4000001 us");
  expect(html[3].measurements).toContain("Connection acquisition wait");
  expect(html[3].measurements).toContain("Queries waiting for locks");
});

test("advanced reference settings use existing canvas controls and survive undo, redo and saved reload", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import {createElement} from "react"; import {renderToStaticMarkup} from "react-dom/server";
    import {Inspector} from "./src/features/canvas/components/inspector/Inspector";
    import {updateResource} from "./src/features/canvas/actions"; import {useCanvasStore} from "./src/features/canvas/store/canvasStore";
    import {undo,redo} from "./src/features/canvas/history";
    const rows=await Bun.stdin.json(), result=[], store=useCanvasStore.getState;
    for (const [i,start] of rows.entries()) {
      store().loadLayout(start.resources,start.connectionLines,"advanced-lab","Advanced practice");
      const id=["fw","lb","peer","db"][i], r=store().resources.find(r=>r.id===id);
      const html=renderToStaticMarkup(createElement(Inspector,{resource:r}));
      const patch=i===0 ? {firewallCapacity:{...r.firewallCapacity,maxFlows:8}} : i===1 ? {retry:{...r.retry,maxAttempts:2}} : {skuId:i===2 ? "c5.large" : "db.m5.large"};
      updateResource(id,patch); const changed=structuredClone(store().resources); undo(); const undone=structuredClone(store().resources); redo();const redone=structuredClone(store().resources);
      store().loadLayout(JSON.parse(JSON.stringify(redone)),start.connectionLines,"advanced-lab","Advanced practice");
      result.push({html,changed,undone,redone,reloaded:store().resources});
    } console.log(JSON.stringify(result));
  `], {cwd: resolve(import.meta.dir, "../../web"), stdin: "pipe", stdout: "pipe", stderr: "pipe"});
  child.stdin.write(JSON.stringify(ids.map(id => definition(id).starter))); child.stdin.end();
  const [out, errors] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]); if (await child.exited !== 0) throw Error(errors);
  const results = JSON.parse(out);
  for (const [i, id] of ids.entries()) {
    const r = results[i]; expect(r.changed).toEqual(REFERENCE[id]!.resources); expect(r.undone).toEqual(definition(id).starter!.resources);
    expect(r.redone).toEqual(r.changed); expect(r.reloaded).toEqual(r.changed);
    expect(r.html).toContain(["Tracked connection limit", "Maximum attempts", "c5.large", "db.m5.large"][i]!);
  }
});
