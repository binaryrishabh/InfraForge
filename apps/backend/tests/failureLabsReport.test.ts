import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { buildRunReport } from "../reports/report";
import { preflight } from "../challenges/preflight";
import { definition, REFERENCE, attemptRow, answers } from "./challengeHarness";

test("saved diagnosis displays the actual rule, separate counters, generic requirements and Unknown", async () => {
  const d = definition("find-the-denying-rule"), row = attemptRow(d, d.starter!, answers(d, {"database-admission": "policy-denied", "security-clean": "yes"})), report = buildRunReport(row);
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import {createElement} from "react"; import {renderToStaticMarkup} from "react-dom/server";
    import {ReportMeasurements} from "./src/features/reports/components/ReportMeasurements";
    import {RequirementList} from "./src/features/challenges/components/RequirementList";
    import {SecurityReadings} from "./src/features/canvas/components/inspector/SecuritySection";
    const {report,criteria,checks}=await Bun.stdin.json();
    console.log(JSON.stringify({report:renderToStaticMarkup(createElement(ReportMeasurements,{report,number:1})), requirements:renderToStaticMarkup(createElement(RequirementList,{criteria,checks})), unknown:renderToStaticMarkup(createElement(SecurityReadings,{firewall:true}))}));
  `], {cwd: resolve(import.meta.dir, "../../web"), stdin: "pipe", stdout: "pipe", stderr: "pipe"});
  child.stdin.write(JSON.stringify({report, criteria: d.criteria, checks: preflight(d, d.starter!).checks})); child.stdin.end();
  const [out, errors] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]); if (await child.exited !== 0) throw Error(errors);
  const html = JSON.parse(out);
  expect(html.report).toContain("fw:ingress:quarantine-db"); expect(html.report).toContain("policy-denied:fw:ingress:quarantine-db");
  expect(html.report).toContain("backend deliveries 0"); expect(html.report).toContain("Flow capacity refusals"); expect(html.report).toContain("Expired flow entries");
  expect(html.requirements.match(/<li /g)).toHaveLength(d.criteria.length); expect(html.requirements).toContain(d.criteria[2]!.label);
  expect(html.unknown).toContain("Security measurements: Unknown"); expect(html.unknown).not.toContain("<dd>0</dd>");
});

test("the three reference changes use existing canvas controls and survive undo, redo and reload", async () => {
  const ids = ["find-the-denying-rule", "leave-room-for-firewall-flows", "choose-a-retry-mitigation"];
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import {createElement} from "react"; import {renderToStaticMarkup} from "react-dom/server";
    import {Inspector} from "./src/features/canvas/components/inspector/Inspector";
    import {updateResource} from "./src/features/canvas/actions"; import {useCanvasStore} from "./src/features/canvas/store/canvasStore";
    import {undo,redo} from "./src/features/canvas/history";
    const starts=await Bun.stdin.json(), result=[]; const store=useCanvasStore.getState;
    for(const [i,start] of starts.entries()) {
      store().loadLayout(start.resources,start.connectionLines,"failure-lab","Failures");
      const id=i===2 ? "lb" : "fw", r=store().resources.find(r=>r.id===id);
      const html=renderToStaticMarkup(createElement(Inspector,{resource:r}));
      const patch=i===0 ? {firewallSettings:{...r.firewallSettings,rules:r.firewallSettings.rules.map(rule=>rule.id==="quarantine-db" ? {...rule,priority:20} : rule)}} : i===1 ? {firewallCapacity:{version:1,maxFlows:8}} : {retry:{...r.retry,maxAttempts:2}};
      updateResource(id,patch);const changed=structuredClone(store().resources); undo();const undone=structuredClone(store().resources);redo();const redone=structuredClone(store().resources);
      store().loadLayout(JSON.parse(JSON.stringify(redone)),start.connectionLines,"failure-lab","Failures");
      result.push({html,changed,undone,redone,reloaded:store().resources});
    } console.log(JSON.stringify(result));
  `], {cwd: resolve(import.meta.dir, "../../web"), stdin: "pipe", stdout: "pipe", stderr: "pipe"});
  child.stdin.write(JSON.stringify(ids.map(id => definition(id).starter))); child.stdin.end();
  const [out, errors] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]); if (await child.exited !== 0) throw Error(errors);
  const results = JSON.parse(out);
  for (const [i, id] of ids.entries()) {
    const r = results[i]; expect(r.changed).toEqual(REFERENCE[id]!.resources); expect(r.undone).toEqual(definition(id).starter!.resources);
    expect(r.redone).toEqual(r.changed); expect(r.reloaded).toEqual(r.changed);
    expect(r.html).toContain(["quarantine-db", "Tracked connection limit", "Maximum attempts"][i]!);
  }
});
