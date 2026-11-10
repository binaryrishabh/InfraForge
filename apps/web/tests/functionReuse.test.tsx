import { afterEach, expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import type { Resource } from "@infraforge/domain/resource";
import type { RunReport } from "@infraforge/contracts/reports";
import { ServerlessSection } from "../src/features/canvas/components/inspector/ServerlessSection";
import { ServerlessReadings } from "../src/features/live/ServerlessReadings";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { ChallengeDebrief } from "../src/features/challenges/components/ChallengeDebrief";
import { lessonRunMeasurements } from "../src/features/learning/runSummaryData";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const fn: Resource = {id: "fn", type: "Serverless Function", x: 0, y: 0, serverless: {version: 1, concurrency: 1, initializationMs: 600, durationMs: 10, timeoutMs: 2000, idleExpiryMs: 100}};
afterEach(() => {useCanvasStore.getState().clearCanvas(); useAuthStore.setState({user: null, status: "guest"});});

test("the existing idle expiry control changes one saved setting and survives save/reload", async () => {
  useAuthStore.setState({user: {id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString()}, status: "authenticated"});
  useCanvasStore.getState().loadLayout([fn], [], "layout", "Warm function");
  const tree = ServerlessSection({resource: useCanvasStore.getState().resources[0]!, disabled: false});
  type Control = ReactElement<{onChange: (e: {target: {value: string}}) => void}>;
  const fields = tree.props.children[0] as ReactElement<{label: string; children: (ids: {id: string}) => Control}>[];
  const field = fields.find(f => f.props.label === "Warm instance idle expiry (ms)")!;
  field.props.children({id: "idle"}).props.onChange({target: {value: "5000"}});
  expect(useCanvasStore.getState().resources[0]).toEqual({...fn, serverless: {...fn.serverless!, idleExpiryMs: 5000}});
  expect(renderToStaticMarkup(<ServerlessSection resource={fn} disabled />)).toContain("Warm instance idle expiry (ms)");
  const saved = spyOn(http, "put").mockResolvedValue({data: {updatedInfrastructure: {id: "layout", name: "Warm function"}}});
  try {
    await saveDesign();
    const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as {layout: {resources: Resource[]}};
    useCanvasStore.getState().clearCanvas();
    useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "Warm function");
    expect(useCanvasStore.getState().resources[0]).toEqual({...fn, serverless: {...fn.serverless!, idleExpiryMs: 5000}});
  } finally {saved.mockRestore();}
});

test("real saved reuse reports render measured expiry, initialization, generic verdicts and Unknowns", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/functionReuseReport.fixture.ts")], {stdout: "pipe", stderr: "pipe"});
  const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(await child.exited, err).toBe(0);
  const reports = JSON.parse(out) as RunReport[];
  for (const [i, report] of reports.entries()) {
    const f = report.terminal!.resources.find(r => r.id === "fn")!.serverless!;
    const html = renderToStaticMarkup(<ReportMeasurements report={report} number={3} />);
    expect(html).toContain(`Cold starts</dt><dd>${i === 1 ? 1 : 8}</dd>`);
    expect(html).toContain(`Idle instances expired</dt><dd>${i === 1 ? 0 : 8}</dd>`);
    expect(html).toContain(`Initialization time (us)</dt><dd>${f.lifecycle!.initializationUs}</dd>`);
    const debrief = renderToStaticMarkup(<MemoryRouter><ChallengeDebrief evaluation={report.challenge!} brief={null} /></MemoryRouter>);
    expect(debrief).toContain(i === 1 ? "Every requirement was met." : "Not every requirement was met.");
    for (const c of report.challenge!.criteria) expect(debrief).toContain(c.detail);
    const evidence = ["Function: Completed invocations", "Cold starts", "Warm starts", "Idle instances expired", "Initialization time (us)", "Total settled duration (us)"];
    const values = lessonRunMeasurements(report, evidence).map(m => m.value);
    expect(values).toEqual(["fn: 8", `fn: ${f.coldStarts}`, `fn: ${f.warmStarts}`, `fn: ${f.expired}`, `fn: ${f.lifecycle!.initializationUs}`, `fn: ${f.lifecycle!.totalDurationUs}`]);
    const old = structuredClone(report); delete old.terminal!.resources.find(r => r.id === "fn")!.serverless!.lifecycle;
    expect(lessonRunMeasurements(old, ["Initialization time (us)"])[0]!.value).toBe("fn: Unknown");
    expect(renderToStaticMarkup(<ServerlessReadings metrics={{...f, lifecycle: undefined}} />)).toContain("Initialization time (us)</dt><dd>Unknown</dd>");
  }
});
