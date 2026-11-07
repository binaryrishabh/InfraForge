// Real router payloads and server-rendered production pages. Only resolved request
// state and device storage are seams; browser key events/AT scheduling are not claimed.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mock } from "bun:test";
import { isAxiosError } from "axios";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { LearningCatalog, LearningLessonDetail } from "@infraforge/contracts/learning";
import type { RunReport } from "@infraforge/contracts/reports";
import { API_URL, http } from "../../src/client/httpClient";
import { getLearningCatalog, getLearningLesson } from "../../src/features/learning/learning.api";
import { EMPTY_FILTERS, type LearningFilters } from "../../src/features/learning/discovery";
import type { DeviceLessonState } from "../../src/features/learning/deviceLocal";
import type { LearningRequest } from "../../src/features/learning/viewModels";

interface Proof {
  foundations: LearningCatalog; attemptedCatalog: LearningCatalog; curriculumDetails: LearningLessonDetail[];
  audit: {
    unattemptedLab: LearningLessonDetail; failedLab: LearningLessonDetail; failedReport: RunReport;
    blockedLab: LearningLessonDetail; blockedReport: RunReport; staleCatalog: LearningCatalog; staleLab: LearningLessonDetail;
    superseded: LearningLessonDetail; missing: { message: string }; oldId: { message: string }; missingIdStatus: number; missingIdBody: string;
    serverError: { message: string }; catalogError: { message: string };
  };
}
const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("../../../backend/tests/fixtures/learningRoutes.ts", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
assert.deepEqual({ code, stderr }, { code: 0, stderr: "" });
const proof = (JSON.parse(stdout) as { webProof: Proof }).webProof;
const { audit } = proof;
const ready = <T,>(data: T | null): LearningRequest<T> => ({ data, loading: false, error: null, retry() {} });
let catalogRequest = ready<LearningCatalog>(proof.foundations);
let lessonRequest = ready<LearningLessonDetail>(null);
let reportRequest = ready<RunReport>(null);
const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value),
} });
mock.module("../../src/api/useRequest", () => ({ useRequest: (_load: unknown, message: string) => {
  if (message.startsWith("Learning could")) return catalogRequest;
  if (message.startsWith("This lesson")) return lessonRequest;
  if (message.startsWith("Your recorded cues")) return reportRequest;
  if (message.startsWith("Eligible comparisons")) return ready(null);
  throw Error(`Unexpected request seam: ${message}`);
} }));
const { LearningPage, LearningList } = await import("../../src/features/learning/LearningPage");
const { LessonPage, LessonBody } = await import("../../src/features/learning/LessonPage");
const { ContinueLearning } = await import("../../src/features/learning/ContinueLearning");
const { Button } = await import("../../src/ui/Button");
const { Field } = await import("../../src/ui/Field");
const render = (node: ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
const route = (path: string) => renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><Routes>
  <Route path="/learn" element={<LearningPage />} />
  <Route path="/learn/lessons/:lessonId" element={<LessonPage />} />
  <Route path="/learn/lessons" element={<LessonPage />} />
</Routes></MemoryRouter>);
const textOf = (html: string) => html.replace(/<[^>]*>/g, "").trim();
const escaped = (text: string) => renderToStaticMarkup(<span>{text}</span>).slice(6, -7);
const attr = (tag: string, key: string) => tag.match(new RegExp(`(?:^|\\s)${key}="([^"]*)"`))?.[1];
let controls = 0;
function accessible(html: string, page: boolean) {
  if (page) assert.equal([...html.matchAll(/<h1[ >]/g)].length, 1, "one page heading");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]!);
  assert.equal(new Set(ids).size, ids.length, "unique ids");
  for (const match of html.matchAll(/\saria-(?:describedby|labelledby)="([^"]+)"/g)) {
    for (const id of match[1]!.split(" ")) assert.ok(ids.includes(id), `reference ${id} exists`);
  }
  const levels = [...html.matchAll(/<h([1-6])[ >]/g)].map(match => Number(match[1]));
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i]! <= levels[i - 1]! + 1, "no skipped heading levels");
  assert.doesNotMatch(html, /tabindex="[1-9]|role="application"/);
  for (const match of html.matchAll(/<(a|button|select|input|textarea|summary)\b([^>]*)(?:>([\s\S]*?)<\/\1>|\/>)/g)) {
    const [, tag, attrs, content = ""] = match;
    const id = attr(attrs!, "id");
    const labelled = !!id && html.includes(`<label for="${id}"`);
    const wrappingLabel = tag === "input" && html.lastIndexOf("<label", match.index) > html.lastIndexOf("</label", match.index)
      && !!textOf(html.slice(match.index, html.indexOf("</label>", match.index)));
    assert.ok(attr(attrs!, "aria-label") || attr(attrs!, "aria-labelledby") || labelled || wrappingLabel ||
      ["a", "button", "summary"].includes(tag!) && textOf(content), `accessible name for ${tag}: ${attrs}`);
    if (tag === "a") assert.ok(attr(attrs!, "href"), "links have a keyboard destination");
    assert.notEqual(attr(attrs!, "tabindex"), "-1", "interactive elements remain in native keyboard order");
    controls++;
  }
  assert.doesNotMatch(html, /\b\d+(?:\.\d+)?% (?:complete|mastery)|mastery score|learning streak/i);
}
type Element = ReactElement<Record<string, unknown>>;
function elements(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap(child => isValidElement<Record<string, unknown>>(child)
    ? [child, ...elements(child.props.children as ReactNode)] : []);
}

// Full page wrappers retain the heading while their request state changes.
catalogRequest = { ...ready(null), loading: true };
accessible(route("/learn"), true);
catalogRequest = { ...ready(null), error: "Learning could not be loaded. Try again." };
accessible(route("/learn"), true);
catalogRequest = ready(proof.foundations);
accessible(route("/learn"), true);

// Drive production select handlers with the actual router catalog. Each individual
// filter has results, while this particular combination has none.
let filters: LearningFilters = { ...EMPTY_FILTERS };
const listTree = () => LearningList({ ...catalogRequest, filters, onFilters: value => { filters = value; } });
for (const [label, value] of [["Track", "foundations"], ["Level", "advanced"], ["Kind", "reading"]]) {
  const field = elements(listTree()).find(element => element.type === Field && element.props.label === label)!;
  const control = (field.props.children as (ids: { id: string }) => ReactElement<{ onChange(event: { target: { value: string } }): void }>)({ id: "audit-filter" });
  control.props.onChange({ target: { value: value! } });
}
const empty = render(listTree()); accessible(empty, false);
assert.ok(empty.includes("No lessons match these filters"));
assert.ok(empty.includes("0 lessons found"));
for (const label of ["Track", "Level", "Kind"]) {
  const labelId = [...empty.matchAll(/<label for="([^"]+)"[^>]*>([^<]+)<\/label>/g)].find(match => match[2] === label)?.[1];
  assert.ok(labelId && [...empty.matchAll(/<select\b([^>]*)>/g)].some(match => attr(match[1]!, "id") === labelId), `${label} uses a labelled native select`);
}
const clear = elements(listTree()).find(element => element.type === Button && element.props.children === "Clear filters")!;
(clear.props.onClick as () => void)();
assert.deepEqual(filters, EMPTY_FILTERS);
assert.ok(!render(listTree()).includes("No lessons match these filters"));

// Every published kind/lesson: real content, prerequisites, headings, controls,
// unanswered and both answered states. Existing learningApi tests verify feedback text.
const kinds = new Set<string>(); let checkedReadings = 0, uncheckedReadings = 0;
for (const detail of proof.curriculumDetails) {
  lessonRequest = ready(detail); reportRequest = ready<RunReport>(null);
  const html = route(`/learn/lessons/${detail.lesson.id}`); accessible(html, true);
  kinds.add(detail.lesson.kind);
  for (const limitation of detail.lesson.limitations) assert.ok(html.includes(escaped(limitation)));
  if (detail.lesson.kind !== "executable-lab") assert.ok(!html.includes("Server activity:"));
  if (detail.lesson.kind === "reading") {
    if (detail.lesson.check) checkedReadings++;
    else uncheckedReadings++;
  }
  if (!detail.lesson.check) continue;
  let local: DeviceLessonState = { read: false, answer: null };
  const body = () => LessonBody({ detail, catalog: proof.foundations, local, storageAvailable: true,
    onLocal: value => { local = value; }, onOpen() {}, busy: false });
  for (const choice of detail.lesson.check.choices) {
    const input = elements(body()).find(element => element.type === "input" && element.props.value === choice.id)!;
    (input.props.onChange as () => void)();
    const answered = render(body()); accessible(answered, false);
    assert.ok(answered.includes('role="status" aria-live="polite"'));
    assert.ok(answered.includes("saved on this device"));
    assert.ok(answered.includes(choice.id === detail.lesson.check.correctChoiceId ? "That matches the explanation." : "Revisit the explanation."));
  }
}
assert.ok(checkedReadings > 0 && uncheckedReadings > 0);
assert.deepEqual([...kinds].sort(), ["conceptual-exercise", "executable-lab", "reading"]);

// Router-derived attempts: no run, a completed near miss, blocked before evaluation,
// and an old-version attempt. No web-authored status/count/measurement payloads.
const attemptStates: string[] = [];
for (const [name, detail, report] of [
  ["unattempted", audit.unattemptedLab, null], ["failed", audit.failedLab, audit.failedReport],
  ["blocked", audit.blockedLab, audit.blockedReport], ["stale", audit.staleLab, null],
] as const) {
  lessonRequest = ready(detail); reportRequest = ready(report);
  catalogRequest = ready(name === "stale" ? audit.staleCatalog : proof.attemptedCatalog);
  const html = route(`/learn/lessons/${detail.lesson.id}`); accessible(html, true);
  if (name === "unattempted") {
    assert.ok(html.includes("No recorded attempts")); assert.ok(html.includes("No outcome is claimed"));
    assert.ok(!html.includes("Your latest recorded attempt"));
  } else {
    assert.ok(html.includes("Recorded attempt"));
    assert.ok(html.includes(`href="/runs/${detail.progress!.lastRunId}"`));
    assert.ok(!html.includes("Current requirements met"));
  }
  if (name === "blocked") {
    assert.ok(html.includes("Not evaluated"));
    assert.ok(report!.challenge!.criteria.some(criterion => criterion.status === "not-evaluated"));
    assert.ok(html.includes("Exact terminal snapshot: second 0"));
    const plan = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(match => textOf(match[2]!) === "Plan one change");
    assert.ok(plan);
    assert.equal(plan[1]!.includes('disabled=""'), !report!.guidedReview?.canImprove,
      "improvement availability follows retained source eligibility, not an invented outcome");
  }
  if (name === "failed") assert.ok(html.includes("Not met"));
  if (name === "stale") assert.ok(html.includes("includes earlier version activity"));
  attemptStates.push(name);
}

const continueStates: string[] = [];
for (const [name, catalog] of [["no-attempts", proof.foundations], ["one-attempt", proof.attemptedCatalog], ["stale-attempt", audit.staleCatalog]] as const) {
  const html = render(<ContinueLearning {...ready(catalog)} />); accessible(html, false);
  const suggestion = catalog.suggestions.continue ?? catalog.suggestions.nextLesson;
  assert.ok(suggestion && html.includes(escaped(suggestion.reason)));
  assert.ok(html.includes(`href="/learn/lessons/${suggestion.lessonId}"`));
  if (name === "no-attempts") assert.ok(!html.includes("Recorded attempt"));
  if (name === "stale-attempt") assert.ok(!html.includes("Current requirements met"));
  continueStates.push(name);
}

// The real client still encodes IDs and rejects genuine router error responses.
const requests: string[] = [];
http.defaults.adapter = async config => {
  requests.push(config.url!);
  if (config.url === `${API_URL}/learning/lessons/`) {
    throw Object.assign(Error("Not found"), { isAxiosError: true, response: { status: audit.missingIdStatus, data: audit.missingIdBody } });
  }
  const error = config.url === `${API_URL}/learning` ? audit.catalogError
    : config.url?.endsWith("/missing") ? audit.missing : config.url?.endsWith("/split-the-capacity-budget-v1") ? audit.oldId : audit.serverError;
  throw Object.assign(Error(error.message), { isAxiosError: true, response: { status: error === audit.serverError || error === audit.catalogError ? 500 : 404, data: error } });
};
for (const id of ["", "missing", "split-the-capacity-budget-v1", "api-lab"]) {
  await assert.rejects(() => getLearningLesson(id), (error: unknown) => isAxiosError(error) && error.response?.status === (id === "api-lab" ? 500 : 404));
  lessonRequest = { ...ready(null), error: "This lesson could not be loaded. It may be unavailable. Try again." };
  const html = route(`/learn/lessons/${id}`); accessible(html, true);
  assert.ok(html.includes("Lesson unavailable") && html.includes('role="alert"') && html.includes("Back to Learning"));
}
assert.equal(audit.missingIdStatus, 404);
await assert.rejects(getLearningCatalog);
assert.deepEqual(requests, ["", "missing", "split-the-capacity-budget-v1", "api-lab"].map(id => `${API_URL}/learning/lessons/${id}`).concat(`${API_URL}/learning`));
lessonRequest = { ...ready(null), loading: true };
accessible(route("/learn/lessons/missing"), true);

lessonRequest = ready(audit.superseded); reportRequest = ready<RunReport>(null); catalogRequest = ready(proof.foundations);
const current = route("/learn/lessons/split-the-capacity-budget?version=1"); accessible(current, true);
assert.equal(audit.superseded.lesson.contentVersion, 4);
assert.ok(current.includes("Monthly resource price line items; Remaining monthly budget"));
assert.ok(!current.includes("omits individual SKU prices"));

console.log(JSON.stringify({ lessons: proof.curriculumDetails.length, kinds: [...kinds].sort(), checkedReadings, uncheckedReadings,
  controls, attemptStates, continueStates, requestStates: ["loading", "missing-id", "unknown-id", "old-id", "server-error"],
  filters: true, supersededCurrentVersion: audit.superseded.lesson.contentVersion }));
