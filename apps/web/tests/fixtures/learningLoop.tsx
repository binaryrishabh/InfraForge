// Isolated component/navigation seams; payloads come from the real Model 2 engine.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LearningCatalog, LearningLessonDetail } from "@infraforge/contracts/learning";
import type { RunReport, RunComparison, RunSummary } from "@infraforge/contracts/reports";
import type { Infrastructure } from "@infraforge/contracts/infrastructure";
import { API_URL, http } from "../../src/client/httpClient";
import { useCanvasStore } from "../../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../../src/features/auth/store/auth.store";

const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("../../../backend/tests/fixtures/learningLoop.ts", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
assert.deepEqual({ code, stderr }, { code: 0, stderr: "" });
const proof = JSON.parse(stdout) as { catalog: LearningCatalog; laterCatalog: LearningCatalog; detail: LearningLessonDetail; laterDetail: LearningLessonDetail;
  sourceReport: RunReport; improvedReport: RunReport; comparison: RunComparison; design: Infrastructure };

let currentReport = proof.sourceReport, catalog = proof.catalog, detail = proof.detail;
let options: RunSummary[] = [], pair: RunComparison | null = null, failed = false, wrongReport = false;
const requests: { url: string; method: string; data: unknown }[] = [];
http.defaults.adapter = async (config) => {
  assert.equal(config.withCredentials, true);
  requests.push({ url: config.url!, method: config.method!, data: config.data ? JSON.parse(config.data as string) : null });
  if (failed) throw Error("Unavailable");
  let data: unknown;
  if (config.url === `${API_URL}/learning`) data = catalog;
  else if (config.url === `${API_URL}/learning/lessons/${detail.lesson.id}`) data = detail;
  else if (config.url?.endsWith("/report")) data = { report: wrongReport ? { ...currentReport, challenge: { ...currentReport.challenge, challengeId: "other" } } : currentReport };
  else if (config.url?.endsWith("/compare-options")) data = { runs: options };
  else if (config.url?.endsWith("/compare")) data = { comparison: pair };
  else if (config.url?.endsWith("/improvement-workspace")) data = { infrastructure: proof.design };
  else throw Error(`Unexpected route ${config.url}`);
  return { data, status: 200, statusText: "OK", config, headers: {} };
};
const { getLearningCatalog, getLearningLesson } = await import("../../src/features/learning/learning.api");
const { findReportLesson } = await import("../../src/features/learning/reportLessonData");
const { getLatestLessonReport, getLessonComparison } = await import("../../src/features/learning/lessonActivityData");
const { getRunReport, getComparison } = await import("../../src/api/reports.api");
const ready = <T,>(data: T | null) => ({ data, loading: false, error: null, retry() {} });
let lessonLink = await findReportLesson(currentReport.challenge!.challengeId);
assert.equal(lessonLink?.lesson.id, detail.lesson.id);
assert.equal(await findReportLesson("no-lesson"), null);
assert.equal(await getLatestLessonReport({ ...detail, progress: null }), null);
assert.equal(await getLatestLessonReport({ ...detail, progress: { ...detail.progress!, challengeId: "other" } }), null);
assert.equal((await getLatestLessonReport(detail))?.run.id, currentReport.run.id);
wrongReport = true;
await assert.rejects(() => getLatestLessonReport(detail), /does not belong/);
wrongReport = false;
assert.equal(await getLessonComparison(currentReport), null);
assert.equal(await getLessonComparison({ ...currentReport, run: { ...currentReport.run, status: "browser" } }), null);
failed = true;
await assert.rejects(() => getLatestLessonReport(detail), /Unavailable/);
failed = false;

// Route components receive resolved request states; the real clients/loaders above
// and below exercise the authenticated endpoint URLs rather than mocked verdicts.
mock.module("../../src/api/useRequest", () => ({ useRequest: (_load: unknown, message = "") => {
  if (message.startsWith("The recorded run")) return ready(currentReport);
  if (message.startsWith("This lesson")) return ready(detail);
  if (message.startsWith("Learning could")) return ready(catalog);
  if (message.startsWith("The lesson follow-up")) return ready(lessonLink);
  if (message.startsWith("Your recorded cues")) return ready(currentReport);
  if (message.startsWith("Eligible comparisons")) return ready(pair);
  if (message.startsWith("The comparison")) return ready(pair);
  return ready(null);
} }));
const router = await import("react-router-dom");
const navigation: { to: string; options: unknown }[] = [];
mock.module("react-router-dom", () => ({ ...router, useNavigate: () => (to: string, options: unknown) => { navigation.push({ to, options }); } }));
const { RunReportPage } = await import("../../src/features/reports/pages/RunReportPage");
const { LessonPage } = await import("../../src/features/learning/LessonPage");
const { ComparePage } = await import("../../src/features/reports/pages/ComparePage");
const { LearningPage } = await import("../../src/features/learning/LearningPage");
const { LessonActivityContent, LessonComparisonContent } = await import("../../src/features/learning/LessonActivity");
const route = (path: string) => renderToStaticMarkup(<router.MemoryRouter initialEntries={[path]}><router.Routes>
  <router.Route path="/runs/:deploymentId" element={<RunReportPage />} />
  <router.Route path="/learning/lessons/:lessonId" element={<LessonPage />} />
  <router.Route path="/runs/compare" element={<ComparePage />} />
  <router.Route path="/learning" element={<LearningPage />} />
</router.Routes></router.MemoryRouter>);
const render = (node: React.ReactNode) => renderToStaticMarkup(<router.MemoryRouter>{node}</router.MemoryRouter>);

catalog = await getLearningCatalog(); detail = await getLearningLesson(detail.lesson.id);
currentReport = await getRunReport(currentReport.run.id);
const reportHtml = route(`/runs/${currentReport.run.id}`);
assert.ok(reportHtml.includes(`Part of lesson ${detail.lesson.title}`));
assert.ok(reportHtml.includes(detail.lesson.followUp!));
const lessonPath = `/learning/lessons/${detail.lesson.id}`;
assert.ok(reportHtml.includes(`href="${lessonPath}"`));
const recorded = currentReport;
currentReport = { ...recorded, challenge: null, run: { ...recorded.run, challenge: null } };
assert.ok(!route(`/runs/${currentReport.run.id}`).includes("Part of lesson"));
currentReport = recorded;
const lessonHtml = route(lessonPath);
assert.ok(lessonHtml.includes("Open challenge lab"));
assert.ok(lessonHtml.includes("Your latest recorded attempt"));
assert.ok(lessonHtml.includes("What did my run show?"));
assert.ok(lessonHtml.indexOf("What did my run show?") > lessonHtml.indexOf("Your latest recorded attempt"));
assert.ok(lessonHtml.includes(`${currentReport.terminal!.traffic!.latencyMs.p95} ms`));
assert.ok(lessonHtml.includes("Plan one change"));
assert.ok(!lessonHtml.includes("Compare recorded attempts"));
for (const cue of currentReport.guidedReview!.cues) {
  // React escapes text before rendering it; check each exact server statement/limit.
  const escaped = renderToStaticMarkup(<span>{cue.statement}</span>).slice(6, -7);
  const limit = renderToStaticMarkup(<span>{cue.limit}</span>).slice(6, -7);
  assert.ok(lessonHtml.includes(escaped)); assert.ok(lessonHtml.includes(limit));
}
assert.ok(lessonHtml.includes("Read the full evidence record in the linked report"));
assert.ok(route("/learning").includes("Worth revisiting"));
for (const suggestion of catalog.suggestions.reviewCandidates) assert.ok(route("/learning").includes(suggestion.reason));
const missing = render(<LessonActivityContent {...ready({ ...currentReport, guidedReview: null })} />);
assert.ok(missing.includes("No guided review cues were retained"));
assert.ok(missing.includes("disabled"));
const missingMeasurements = render(<LessonActivityContent {...ready({ ...currentReport, terminal: null, checkpoint: currentReport.terminal })} lesson={detail.lesson} />);
assert.ok(missingMeasurements.includes("What did my run show?"));
assert.ok(missingMeasurements.includes("<dt class=\"font-medium\">p95</dt><dd>Unknown</dd>"));
assert.ok(!render(<LessonActivityContent {...ready<RunReport>(null)} error="No outcome is known" lesson={detail.lesson} />).includes("What did my run show?"));
assert.ok(render(<LessonActivityContent {...ready<RunReport>(null)} error="No outcome is known" />).includes("No outcome is known"));
assert.ok(!render(<LessonComparisonContent {...ready<RunComparison>(null)} />).includes("Compare recorded attempts"));
assert.ok(render(<LessonComparisonContent {...ready<RunComparison>(null)} error="Comparison unknown" />).includes("Comparison unknown"));

// Drive the real improvement form handlers with a small isolated hook state seam.
// This proves a placeholder cannot become the submitted learner hypothesis.
let manual = false, cursor = 0;
const originalUseState = React.useState, originalUseRef = React.useRef;
const states: unknown[] = [];
mock.module("react", () => ({ ...React, useState: (initial: unknown) => {
  if (!manual) return originalUseState(initial);
  const i = cursor++;
  if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial;
  return [states[i], (value: unknown) => { states[i] = value; }];
}, useRef: (value: unknown) => manual ? { current: value } : originalUseRef(value) }));
const originalCanvas = useCanvasStore;
mock.module("../../src/features/canvas/store/canvasStore", () => ({ useCanvasStore: Object.assign(
  (select: (state: ReturnType<typeof originalCanvas.getState>) => unknown) => manual ? select(originalCanvas.getState()) : originalCanvas(select), originalCanvas) }));
const { BeginImprovement } = await import("../../src/features/challenges/components/BeginImprovement");
const { Button } = await import("../../src/ui/Button");
const { Field } = await import("../../src/ui/Field");
const { Dialog } = await import("../../src/ui/Dialog");
type Element = React.ReactElement<Record<string, unknown>>;
function elements(node: React.ReactNode): Element[] {
  return React.Children.toArray(node).flatMap((child) => React.isValidElement<Record<string, unknown>>(child)
    ? [child, ...elements(child.props.children as React.ReactNode)] : []);
}
const formTree = () => { cursor = 0; manual = true; try { return BeginImprovement({ report: currentReport, suggestion: detail.lesson.followUp }); } finally { manual = false; } };
useCanvasStore.getState().clearCanvas();
useAuthStore.setState({ user: { id: "alice", name: "Alice", username: null, email: "alice@example.test", emailVerified: true, createdAt: "2026-11-01T00:00:00Z" } });
let tree = formTree();
const plan = elements(tree).find((e) => e.type === Button && e.props.children === "Plan one change")!;
(plan.props.onClick as () => void)(); tree = formTree();
assert.equal(elements(tree).find((e) => e.type === Dialog)!.props.open, true);
const form = () => elements(formTree()).find((e) => e.type === "form")!;
const textarea = () => {
  const field = elements(formTree()).find((e) => e.type === Field)!;
  return (field.props.children as (ids: { id: string; describedBy: string }) => Element)({ id: "hypothesis", describedBy: "hint" });
};
assert.equal(textarea().props.placeholder, detail.lesson.followUp);
assert.equal(textarea().props.value, "");
const submit = async () => { await (form().props.onSubmit as (event: { preventDefault(): void }) => Promise<void>)({ preventDefault() {} }); };
const before = requests.length;
await submit(); assert.equal(requests.length, before); assert.equal(navigation.length, 0);
(textarea().props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "   " } });
await submit(); assert.equal(requests.length, before);
const hypothesis = "I expect the app size change to reduce app CPU at the recorded second.";
(textarea().props.onChange as (event: { target: { value: string } }) => void)({ target: { value: hypothesis } });
useCanvasStore.setState({ activeDeploymentId: "live", liveMode: true });
await submit(); assert.equal(requests.length, before);
useCanvasStore.getState().clearCanvas();
await submit();
assert.equal(navigation.length, 1); assert.equal(navigation[0]!.to, "/design");
const routeState = (navigation[0]!.options as { state: { challengeImprovement: { hypothesis: string; sourceRunId: string } } }).state;
assert.equal(routeState.challengeImprovement.hypothesis, hypothesis);
assert.equal(routeState.challengeImprovement.sourceRunId, currentReport.run.id);
assert.deepEqual(requests.at(-1), { url: `${API_URL}/challenges/${detail.lesson.experiment!.challengeId}/improvement-workspace`, method: "post", data: { sourceRunId: currentReport.run.id } });
assert.equal(useCanvasStore.getState().currentLayoutId, proof.design.id);

// The second payload is another real engine run with an explicitly recorded source.
// Navigate back to its lesson and follow the actual comparison URL.
manual = false;
currentReport = proof.improvedReport; catalog = proof.laterCatalog; detail = proof.laterDetail;
lessonLink = await findReportLesson(currentReport.challenge!.challengeId);
options = [proof.sourceReport.run];
pair = proof.comparison;
assert.equal((await getLessonComparison(currentReport))?.challengeConditions, proof.comparison.challengeConditions);
const after = route(lessonPath), comparePath = `/runs/compare?a=${pair.runs[0].id}&b=${pair.runs[1].id}`;
assert.ok(after.includes(`href="${comparePath.replaceAll("&", "&amp;")}"`));
assert.ok(after.includes("Same challenge version, rules, workload, seed, evaluation second and scheduled fault."));
assert.ok(route(comparePath).includes("Compare two runs"));
assert.equal((await getComparison(pair.runs[0].id, pair.runs[1].id)).lineage, "source-and-improvement");

options = [{ ...proof.sourceReport.run, status: "browser" }, { ...proof.sourceReport.run, id: "unrelated", challenge: { ...proof.sourceReport.run.challenge!, id: "other" } }];
assert.equal(await getLessonComparison(currentReport), null);
options = [proof.sourceReport.run];
pair = { ...proof.comparison, available: false };
assert.equal(await getLessonComparison(currentReport), null);
assert.ok(!render(<LessonComparisonContent {...ready(pair)} />).includes("Compare recorded attempts"));
pair = { ...proof.comparison, runs: [proof.improvedReport.run, proof.improvedReport.run] };
assert.equal(await getLessonComparison(currentReport), null);
assert.ok(!render(<LessonComparisonContent {...ready(pair)} />).includes("Compare recorded attempts"));
for (const conditions of ["different", null] as const) {
  const html = render(<LessonComparisonContent {...ready({ ...proof.comparison, challengeConditions: conditions })} />);
  assert.ok(html.includes(conditions === null ? "Unknown" : "Different challenge versions or recorded conditions; their results were judged by different rules."));
}
assert.ok(!reportHtml.includes("so the difference you see comes from your change"));
useCanvasStore.getState().clearCanvas();
console.log(JSON.stringify({ loop: true, hintNeverSubmitted: true, realModel2: true, guards: true, missingEvidence: true }));
