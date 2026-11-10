import { afterEach, expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import type { Resource } from "@infraforge/domain/resource";
import type { RunReport } from "@infraforge/contracts/reports";
import { LbAdmissionSection } from "../src/features/canvas/components/inspector/LbAdmissionSection";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { ChallengeDebrief } from "../src/features/challenges/components/ChallengeDebrief";
import { lessonRunMeasurements } from "../src/features/learning/runSummaryData";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const lb: Resource = {id: "lb", type: "Load Balancer", x: 0, y: 0, lbAdmission: {version: 1, maxActive: 1, maxQueued: 64, queueWaitMs: 100}};
afterEach(() => {useCanvasStore.getState().clearCanvas(); useAuthStore.setState({user: null, status: "guest"});});

test("forwarding control changes only active admission and survives save/reload", async () => {
  useAuthStore.setState({user: {id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString()}, status: "authenticated"});
  useCanvasStore.getState().loadLayout([lb], [], "layout", "Open the forwarding gate");
  const tree = LbAdmissionSection({resource: useCanvasStore.getState().resources[0]!, disabled: false});
  type Field = ReactElement<{label: string; children: (ids: {id: string; invalid: boolean}) => ReactElement<{onChange: (e: {target: {value: string}}) => void}>}>;
  const fields = tree.props.children.props.children as Field[];
  fields.find(f => f.props.label === "Active requests")!.props.children({id: "active", invalid: false}).props.onChange({target: {value: "16"}});
  const expected = {...lb, lbAdmission: {...lb.lbAdmission!, maxActive: 16}};
  expect(useCanvasStore.getState().resources[0]).toEqual(expected);
  const saved = spyOn(http, "put").mockResolvedValue({data: {updatedInfrastructure: {id: "layout", name: "Open the forwarding gate"}}});
  try {
    await saveDesign();
    const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as {layout: {resources: Resource[]}};
    useCanvasStore.getState().clearCanvas();
    useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "Open the forwarding gate");
    expect(useCanvasStore.getState().resources[0]).toEqual(expected);
  } finally {saved.mockRestore();}
});

test("saved forwarding reports render actual LB accounting, generic verdicts and Unknown evidence", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/lbForwardingReport.fixture.ts")], {stdout: "pipe", stderr: "pipe"});
  const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(await child.exited, err).toBe(0);
  const reports = JSON.parse(out) as RunReport[];
  const labels = ["Rejected at load balancer (calls)", "Queued at load balancer (calls)", "Admitted by backend (attempts)"];
  for (const [i, report] of reports.entries()) {
    const m = report.terminal!.resources.find(r => r.id === "lb")!.lbAccounting!;
    const html = renderToStaticMarkup(<ReportMeasurements report={report} number={3} />);
    for (const [label, value] of [[labels[0]!, m.rejectedAtLb], [labels[1]!, m.queuedAtLb], [labels[2]!, m.acceptedByBackend]] as const) {
      expect(html).toContain(`${label}</dt><dd class="if-num">${value.toLocaleString()}</dd>`);
    }
    const debrief = renderToStaticMarkup(<MemoryRouter><ChallengeDebrief evaluation={report.challenge!} brief={null} /></MemoryRouter>);
    expect(debrief).toContain(i === 1 ? "Every requirement was met." : "Not every requirement was met.");
    for (const c of report.challenge!.criteria) expect(debrief).toContain(c.detail);
    expect(lessonRunMeasurements(report, labels).map(m => m.value)).toEqual([`lb: ${m.rejectedAtLb}`, `lb: ${m.queuedAtLb}`, `lb: ${m.acceptedByBackend}`]);
    expect(lessonRunMeasurements(report, ["Whole run: Completed"])[0]!.value).toBe(String(i === 1 ? 1799 : 1352));
    const old = structuredClone(report); delete old.terminal!.resources.find(r => r.id === "lb")!.lbAccounting;
    expect(lessonRunMeasurements(old, labels).map(m => m.value)).toEqual(["lb: Unknown", "lb: Unknown", "lb: Unknown"]);
    expect(renderToStaticMarkup(<ReportMeasurements report={old} number={3} />)).toContain("Load balancer accounting: Unknown");
  }
});
