import { afterEach, expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import type { Resource } from "@infraforge/domain/resource";
import type { RunReport } from "@infraforge/contracts/reports";
import { VmCpuQuotaSection } from "../src/features/canvas/components/inspector/VmCpuQuotaSection";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { ChallengeDebrief } from "../src/features/challenges/components/ChallengeDebrief";
import { lessonRunMeasurements } from "../src/features/learning/runSummaryData";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const app: Resource = {id: "app", type: "Virtual Machine", x: 0, y: 0, size: "small", vmCpuQuota: {version: 1, limitPercent: 25}, vmExecution: {version: 1, workers: 8, queuedRequests: 256}};
afterEach(() => {useCanvasStore.getState().clearCanvas(); useAuthStore.setState({user: null, status: "guest"});});

test("CPU budget lab edit keeps workers, queue and size and survives save/reload", async () => {
  useAuthStore.setState({user: {id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString()}, status: "authenticated"});
  useCanvasStore.getState().loadLayout([app], [], "layout", "Release the CPU budget");
  const tree = VmCpuQuotaSection({resource: useCanvasStore.getState().resources[0]!, disabled: false});
  const field = tree.props.children as ReactElement<{children: (ids: {id: string}) => ReactElement<{onChange: (e: {target: {value: string}}) => void}>}>;
  field.props.children({id: "quota"}).props.onChange({target: {value: "100"}});
  const expected = {...app, vmCpuQuota: {...app.vmCpuQuota!, limitPercent: 100}};
  expect(useCanvasStore.getState().resources[0]).toEqual(expected);
  const saved = spyOn(http, "put").mockResolvedValue({data: {updatedInfrastructure: {id: "layout", name: "Release the CPU budget"}}});
  try {
    await saveDesign();
    const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as {layout: {resources: Resource[]}};
    useCanvasStore.getState().clearCanvas();
    useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "Release the CPU budget");
    expect(useCanvasStore.getState().resources[0]).toEqual(expected);
  } finally {saved.mockRestore();}
});

test("real CPU budget reports render saved callers, CPU, requirement details and Unknowns", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/cpuBudgetReport.fixture.ts")], {stdout: "pipe", stderr: "pipe"});
  const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(await child.exited, err).toBe(0);
  const reports = JSON.parse(out) as RunReport[];
  const labels = ["Whole run: Completed", "Whole run: Failed", "Whole run: In-flight", "CPU"];
  for (const [i, report] of reports.entries()) {
    expect(lessonRunMeasurements(report, labels).map(m => m.value)).toEqual([
      String([496, 1800, 457][i]), String([1040, 0, 1023][i]), String([264, 0, 320][i]), `app: ${[25, 90, 25][i]} %`,
    ]);
    const html = renderToStaticMarkup(<ReportMeasurements report={report} number={3} />);
    expect(html).toContain(`${report.terminal!.resources[0]!.cpu!.toFixed(1)}%`);
    const debrief = renderToStaticMarkup(<MemoryRouter><ChallengeDebrief evaluation={report.challenge!} brief={null} /></MemoryRouter>);
    expect(debrief).toContain(i === 1 ? "Every requirement was met." : "Not every requirement was met.");
    for (const c of report.challenge!.criteria) expect(debrief).toContain(c.detail);
    const missing = structuredClone(report); delete missing.terminal!.traffic!.wholeRun; delete missing.terminal!.resources[0]!.cpu;
    expect(lessonRunMeasurements(missing, labels).map(m => m.value)).toEqual(["Unknown", "Unknown", "Unknown", "app: Unknown"]);
    const noTerminal = {...report, terminal: null};
    expect(lessonRunMeasurements(noTerminal, labels).map(m => m.value)).toEqual(["Unknown", "Unknown", "Unknown", "app: Unknown"]);
  }
}, 120000);
