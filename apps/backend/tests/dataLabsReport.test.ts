import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { moveReadsOffTheWriterV1 as reads } from "../challenges/definitions/move-reads-off-the-writer/v1";
import { budgetAppDatabaseSessionsV1 as sessions } from "../challenges/definitions/budget-app-database-sessions/v1";
import { preflight } from "../challenges/preflight";
import { buildRunReport } from "../reports/report";
import { REFERENCE, answers, attemptRow } from "./challengeHarness";

test("saved report renders actual database source, writer, member CPU and stale-read evidence with generic requirements", async () => {
  const row = attemptRow(reads, REFERENCE[reads.id]!, answers(reads, {"database-health": "healthy"}));
  const report = buildRunReport(row), checks = preflight(reads, reads.starter!).checks;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { ReportMeasurements } from "./src/features/reports/components/ReportMeasurements";
    import { RequirementList } from "./src/features/challenges/components/RequirementList";
    import { DataDeliveryReadings } from "./src/features/live/DataDeliveryReadings";
    const {report,criteria,checks} = await Bun.stdin.json();
    console.log(JSON.stringify({
      report: renderToStaticMarkup(createElement(ReportMeasurements,{report,number:1})),
      requirements: renderToStaticMarkup(createElement(RequirementList,{criteria,checks})),
      unknown: renderToStaticMarkup(createElement(DataDeliveryReadings,{type:"Database"}))
    }));
  `], {cwd: resolve(import.meta.dir, "../../web"), stdin: "pipe", stdout: "pipe", stderr: "pipe"});
  child.stdin.write(JSON.stringify({report, criteria: reads.criteria, checks})); child.stdin.end();
  const [stdout, errors] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (await child.exited !== 0) throw Error(errors);
  const html = JSON.parse(stdout) as {report: string; requirements: string; unknown: string};
  const db = report.terminal!.resources.find(r => r.id === "db")!, route = db.database!.readRouting!;
  expect(html.report).toContain("Database replication measurements");
  expect(html.report).toContain("Read routing: replica-preferred");
  expect(html.report).toContain(`Stale reads: ${route.staleReads}`);
  expect(html.report).toContain(`${route.members.primary.consumedCoreUs} core-us`);
  expect(html.report).toContain(`${route.members.replica.consumedCoreUs} core-us`);
  for (const [label, count] of [["Primary reads", db.databaseReplication!.primaryReads], ["Replica reads", db.databaseReplication!.replicaReads],
    ["Primary committed writes", db.databaseReplication!.primaryCommittedWrites]] as const) expect(html.report).toContain(`<dt>${label}</dt><dd>${count}</dd>`);
  expect(html.report).toContain("Refused session opens");
  expect(html.requirements.match(/<li /g)).toHaveLength(reads.criteria.length);
  expect(html.requirements).toContain(reads.criteria.find(c => c.id === "latency")!.label);
  expect(html.unknown).toContain("Unknown");
  expect(html.unknown).not.toContain("<dd>0</dd>");
}, 120000);

test("the session reference is reachable through the existing canvas pool control and survives undo/reload", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { Inspector } from "./src/features/canvas/components/inspector/Inspector";
    import { updateResource } from "./src/features/canvas/actions";
    import { useCanvasStore } from "./src/features/canvas/store/canvasStore";
    import { undo, redo } from "./src/features/canvas/history";
    const start = await Bun.stdin.json();
    const store = useCanvasStore.getState;
    store().loadLayout(start.resources,start.connectionLines,"data-lab","Sessions");
    const lb = store().resources.find(r=>r.id==="lb");
    const html = renderToStaticMarkup(createElement(Inspector,{resource:lb}));
    updateResource("lb",{autoscaling:{...lb.autoscaling,minReplicas:4}});
    const changed = structuredClone(store().resources);
    undo(); const undone = structuredClone(store().resources);
    redo(); const redone = structuredClone(store().resources);
    store().loadLayout(JSON.parse(JSON.stringify(redone)),start.connectionLines,"data-lab","Sessions");
    console.log(JSON.stringify({html,changed,undone,redone,reloaded:store().resources}));
  `], {cwd: resolve(import.meta.dir, "../../web"), stdin: "pipe", stdout: "pipe", stderr: "pipe"});
  child.stdin.write(JSON.stringify(sessions.starter)); child.stdin.end();
  const [stdout, errors] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (await child.exited !== 0) throw Error(errors);
  const result = JSON.parse(stdout);
  expect(result.html).toContain("Autoscaling pool"); expect(result.html).toContain("Minimum");
  expect(result.html).toContain("Model 2 starts the minimum number of instances");
  expect(result.changed).toEqual(REFERENCE[sessions.id]!.resources);
  expect(result.undone).toEqual(sessions.starter!.resources);
  expect(result.redone).toEqual(result.changed); expect(result.reloaded).toEqual(result.changed);
});
