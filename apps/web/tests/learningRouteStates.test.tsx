import { expect, test } from "bun:test";
import type { ReactNode } from "react";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import ts from "typescript";
import type { LearningCatalog, LearningLessonDetail } from "@infraforge/contracts/learning";
import type { RunComparison, RunReport } from "@infraforge/contracts/reports";
import { LearningList } from "../src/features/learning/LearningPage";
import { LessonBody, LessonView } from "../src/features/learning/LessonPage";
import { LessonActivityContent, LessonComparisonContent } from "../src/features/learning/LessonActivity";
import { LessonRunSummary } from "../src/features/learning/LessonRunSummary";
import { ContinueLearning } from "../src/features/learning/ContinueLearning";
import { ReportLessonContent } from "../src/features/learning/ReportLesson";
import { LEARNING_VIEW_STATES, catalogView, lessonBodyView, requestView } from "../src/features/learning/viewModels";
import { activityLabel, EMPTY_FILTERS } from "../src/features/learning/discovery";
import { attempted, catalog, concept, lab, reading } from "./learningFixtures";
import { brief } from "./fixtures";
import { startAttempt } from "../src/features/challenges/startAttempt";
import { errorMessage } from "../src/api/errorMessage";
import { API_URL, http } from "../src/client/httpClient";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";

type Group = keyof typeof LEARNING_VIEW_STATES;
type StateCases = { [K in Group]: Record<typeof LEARNING_VIEW_STATES[K][number], () => void | Promise<void>> };
// Only learning surfaces are inventoried on Home/report routes, not their other features.
const routes = {
  "/learning": ["request", "catalog", "visibility", "progress"],
  "/learning/lessons/:lessonId": ["request", "kind", "lab", "check", "storage", "prerequisites", "catalogLinks", "progress", "activity", "comparison", "summary"],
  "/home": ["request", "suggestion"],
  "/runs/:deploymentId": ["request", "followup"],
  "/design": ["runStart"],
} as const satisfies Record<string, readonly Group[]>;
const ready = <T,>(data: T | null) => ({ data, loading: false, error: null, retry() {} });
const render = (node: ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
const detail = (lesson = reading): LearningLessonDetail => ({ lesson, progress: null, challenge: null });
const bodyProps = (data = detail()) => ({ detail: data, catalog, local: { read: false, answer: null } as { read: boolean; answer: string | null },
  storageAvailable: true, onLocal() {}, onOpen() {}, busy: false });
const list = (data = catalog, search = "") => render(<LearningList {...ready(data)} filters={{ ...EMPTY_FILTERS, search }} onFilters={() => {}} />);
// Rendering-state fixture only. Real-engine evidence remains in learningLoop and learnerJourney.
const report: RunReport = { version: 1, run: { id: "fixture-run", infrastructureId: null, infrastructureName: "Fixture", status: "torn-down",
  createdAt: "", updatedAt: "", resourceCount: 0, workload: null, workloadSource: "unavailable", chaosEventCount: null,
  topologyRevision: null, hasReportData: false }, originalSeed: null, legacySeed: null, stages: [], timeline: [], chaosEvents: [],
  topology: { original: null, accepted: null, changes: null }, checkpoint: null, terminal: null, actions: [],
  provenance: { inputVersion: null, simulationModelVersion: null, catalogSnapshot: null }, observed: [], interpreted: [], unknown: [], inspectNext: [],
  challenge: { challengeId: lab.experiment!.challengeId, version: 2, title: "Fixture", evaluationSeconds: 120, definitionMatches: true,
    status: "not-evaluated", statusDetail: "No evidence", metCount: 0, total: 0, criteria: [], predictions: [], reasoning: null,
    predictionSubmittedAt: "", inspectNext: [], experiment: null },
};
const comparison = { available: true, runs: [report.run, { ...report.run, id: "other" }], challengeConditions: null } as RunComparison;

async function refusedStart(status: number, message: string) {
  const adapter = http.defaults.adapter, canvas = useCanvasStore.getState(), user = useAuthStore.getState().user;
  const requests: string[] = [];
  useCanvasStore.setState({ currentLayoutId: "fixture-design", currentChallengeId: brief.id, currentLayoutSaved: true, activeDeploymentId: null, liveLocked: false, isDeploying: false });
  useAuthStore.setState({ user: { id: "fixture-owner", name: "Fixture", username: null, email: "fixture@example.test", emailVerified: true, createdAt: "" } });
  http.defaults.adapter = async config => {
    requests.push(config.url!);
    throw Object.assign(Error(message), { isAxiosError: true, response: { status, data: { message } } });
  };
  try {
    let refusal: unknown;
    try { await startAttempt(brief, { answers: {}, reasoning: null }); } catch (error) { refusal = error; }
    expect(errorMessage(refusal, "Missing refusal")).toBe(message);
    expect(requests).toEqual([`${API_URL}/challenges/${brief.id}/attempts`]);
    const current = useCanvasStore.getState();
    expect(current.activeDeploymentId).toBeNull(); expect(current.liveLocked).toBe(false); expect(current.isDeploying).toBe(false);
  } finally { http.defaults.adapter = adapter; useCanvasStore.setState(canvas); useAuthStore.setState({ user }); }
}

const cases: StateCases = {
  request: {
    loading: () => {
      expect(requestView({ ...ready(catalog), loading: true }, "Missing").state).toBe("loading");
      const nodes = [<LearningList {...ready(catalog)} loading filters={EMPTY_FILTERS} onFilters={() => {}} />,
        <LessonView {...ready(detail())} loading catalog={ready(catalog)} />, <ContinueLearning {...ready(catalog)} loading />,
        <ReportLessonContent {...ready(detail(lab))} loading />, <LessonActivityContent {...ready(report)} loading />,
        <LessonComparisonContent {...ready(comparison)} loading />];
      for (const node of nodes) expect(render(node)).toMatch(/Loading|Finding/);
    },
    error: () => {
      const nodes = [<LearningList {...ready(catalog)} error="Offline" filters={EMPTY_FILTERS} onFilters={() => {}} />,
        <LessonView {...ready(detail())} error="Offline" catalog={ready(catalog)} />, <ContinueLearning {...ready(catalog)} error="Offline" />,
        <ReportLessonContent {...ready(detail(lab))} error="Offline" />, <LessonActivityContent {...ready(report)} error="Offline" />,
        <LessonComparisonContent {...ready(comparison)} error="Offline" />];
      for (const node of nodes) { expect(render(node)).toContain('role="alert"'); expect(render(node)).toContain("Try again"); }
    },
    empty: () => {
      expect(render(<LearningList {...ready<LearningCatalog>(null)} filters={EMPTY_FILTERS} onFilters={() => {}} />)).toContain("Try again");
      expect(render(<LessonView {...ready<LearningLessonDetail>(null)} catalog={ready(catalog)} />)).toContain("Lesson unavailable");
      expect(render(<ReportLessonContent {...ready(null)} />)).toBe("");
      expect(render(<LessonActivityContent {...ready(null)} />)).toBe("");
      expect(render(<LessonComparisonContent {...ready(null)} />)).toContain("No comparison is claimed");
    },
    ready: () => {
      expect(list()).toContain(reading.title);
      expect(render(<LessonView {...ready(detail())} catalog={ready(catalog)} />)).toContain(reading.title);
      expect(render(<ContinueLearning {...ready(catalog)} />)).toContain(reading.title);
      expect(render(<ReportLessonContent {...ready(detail(lab))} />)).toContain(lab.title);
    },
  },
  catalog: {
    results: () => { expect(catalogView(catalog, EMPTY_FILTERS).state).toBe("results"); expect(list()).toContain("3 lessons found"); },
    empty: () => { const data = { ...catalog, tracks: [] }; expect(catalogView(data, EMPTY_FILTERS).state).toBe("empty"); expect(list(data)).toContain("No lessons are available yet"); },
    "no-matches": () => { expect(catalogView(catalog, { ...EMPTY_FILTERS, search: "missing" }).state).toBe("no-matches"); expect(list(catalog, "missing")).toContain("No lessons match"); },
  },
  visibility: {
    visible: () => { expect(catalogView(catalog, EMPTY_FILTERS).visibility).toBe("visible"); expect(list()).toContain(lab.title); },
    "draft-hidden": () => {
      const variants: LearningCatalog[] = [
        { ...catalog, lessons: catalog.lessons.map(l => ({ ...l, availability: "draft" })) },
        { ...catalog, tracks: catalog.tracks.map(t => ({ ...t, availability: "draft" })) },
        { ...catalog, tracks: catalog.tracks.map(t => ({ ...t, modules: t.modules.map(m => ({ ...m, availability: "draft" })) })) },
      ];
      for (const data of variants) {
        expect(catalogView(data, EMPTY_FILTERS).visibility).toBe("draft-hidden");
        expect(list(data)).not.toContain(lab.title); expect(list(data)).not.toContain("Open challenge lab");
      }
    },
  },
  kind: {
    reading: () => { const html = render(<LessonBody {...bodyProps()} />); expect(html).toContain("Conceptual only"); expect(html).not.toContain("Evidence to inspect"); },
    "conceptual-exercise": () => { const html = render(<LessonBody {...bodyProps(detail(concept))} />); expect(html).toContain("Concept check"); expect(html).not.toContain("Evidence to inspect"); },
    "executable-lab": () => { expect(render(<LessonBody {...bodyProps(detail(lab))} />)).toContain("Evidence to inspect"); },
  },
  lab: {
    absent: () => { expect(lessonBodyView(detail(), catalog, bodyProps().local, true).labState).toBe("absent"); expect(render(<LessonBody {...bodyProps()} />)).not.toContain(">Experiment<"); },
    available: () => {
      const data: LearningLessonDetail = { ...detail(lab), challenge: { id: lab.experiment!.challengeId, version: 2, specHash: "a".repeat(64), title: "Lab", summary: "", evaluationSeconds: 120, requirementCount: 0, executable: true } };
      expect(lessonBodyView(data, catalog, bodyProps().local, true).labState).toBe("available");
      expect(render(<LessonBody {...bodyProps(data)} busy />)).toContain("disabled");
      expect(render(<LessonBody {...bodyProps(data)} />)).toContain("Open challenge lab");
    },
    unavailable: () => { expect(lessonBodyView(detail(lab), catalog, bodyProps().local, true).labState).toBe("unavailable"); expect(render(<LessonBody {...bodyProps(detail(lab))} />)).toContain("No experiment result is known"); },
  },
  check: {
    absent: () => { expect(render(<LessonBody {...bodyProps()} />)).toContain("no check question"); },
    unanswered: () => { const props = bodyProps(detail(concept)); expect(lessonBodyView(props.detail, catalog, props.local, true).checkState).toBe("unanswered"); expect(render(<LessonBody {...props} />)).not.toContain("matches the explanation"); },
    correct: () => { expect(render(<LessonBody {...bodyProps(detail(concept))} local={{ read: false, answer: "address" }} />)).toContain("That matches the explanation"); },
    incorrect: () => { expect(render(<LessonBody {...bodyProps(detail(concept))} local={{ read: false, answer: "note" }} />)).toContain("Revisit the explanation"); },
  },
  storage: {
    unused: () => { expect(render(<LessonBody {...bodyProps()} />)).toContain("can be saved on this device"); },
    saved: () => { expect(render(<LessonBody {...bodyProps()} local={{ read: true, answer: null }} />)).toContain("Reading mark and check answers: saved on this device"); },
    unavailable: () => { expect(render(<LessonBody {...bodyProps()} storageAvailable={false} />)).toContain("this visit only"); },
  },
  prerequisites: {
    ready: () => { expect(render(<LessonBody {...bodyProps(detail(concept))} />)).toContain('href="/learning/lessons/request"'); },
    unavailable: () => { expect(render(<LessonBody {...bodyProps()} catalog={null} />)).toContain("Prerequisite links are unavailable"); },
    "missing-reference": () => { expect(render(<LessonBody {...bodyProps(detail({ ...reading, prerequisites: ["missing"] }))} />)).toContain("Prerequisite unavailable: missing"); },
  },
  catalogLinks: {
    loading: () => { const html = render(<LessonView {...ready(detail())} catalog={{ ...ready<LearningCatalog>(null), loading: true }} />); expect(html).toContain("Loading prerequisite and follow-up links"); expect(html).toContain(reading.title); },
    error: () => { const html = render(<LessonView {...ready(detail())} catalog={{ ...ready<LearningCatalog>(null), error: "Offline" }} />); expect(html).toContain("Prerequisite and follow-up links could not be loaded"); expect(html).toContain("Try again"); expect(html).toContain(reading.title); },
    ready: () => { expect(render(<LessonView {...ready(detail(concept))} catalog={ready(catalog)} />)).toContain('href="/learning/lessons/request"'); },
  },
  progress: {
    "not-started": () => { expect(activityLabel(lab, { ...attempted, activity: "not-started", attempts: 0 })).toBe("No recorded attempts"); },
    attempted: () => { expect(activityLabel(lab, attempted)).toBe("Recorded attempt"); },
    "improved-after-attempt": () => { expect(activityLabel(lab, { ...attempted, activity: "improved-after-attempt" })).toBe("Recorded improvement"); },
    "requirements-met": () => { expect(activityLabel(lab, { ...attempted, activity: "requirements-met" })).toBe("Current requirements met"); },
    "earlier-version": () => { expect(activityLabel(lab, { ...attempted, fromEarlierVersion: true })).toBe("Recorded attempt · includes earlier version activity"); },
  },
  activity: {
    absent: () => { expect(render(<LessonActivityContent {...ready(null)} />)).toBe(""); expect(activityLabel(lab, null)).toBeNull(); },
    recorded: () => {
      const retained = { ...report, guidedReview: { canImprove: false, unavailableReason: "No retained evidence", cues: [] } };
      const html = render(<LessonActivityContent {...ready(retained)} />);
      expect(html).toContain("Read the recorded report"); expect(html).toContain("Read this attempt");
    },
    "review-unavailable": () => { const html = render(<LessonActivityContent {...ready(report)} />); expect(html).toContain("No guided review cues were retained"); expect(html).toContain("disabled"); },
  },
  comparison: {
    unavailable: () => { expect(render(<LessonComparisonContent {...ready(null)} />)).toContain("Two eligible recorded attempts are needed"); },
    available: () => { const html = render(<LessonComparisonContent {...ready(comparison)} />); expect(html).toContain("Compare recorded attempts"); expect(html).toContain("Challenge conditions: Unknown"); },
  },
  followup: {
    absent: () => { expect(render(<ReportLessonContent {...ready(detail())} />)).toBe(""); },
    linked: () => { expect(render(<ReportLessonContent {...ready(detail(lab))} />)).toContain('href="/learning/lessons/api-lab"'); },
  },
  summary: {
    absent: () => { expect(render(<LessonRunSummary report={report} lesson={reading} />)).toBe(""); },
    recorded: () => { const html = render(<LessonRunSummary report={report} lesson={lab} />); expect(html).toContain("What did my run show?"); expect(html).toContain("Exact terminal snapshot: Unknown"); },
  },
  suggestion: {
    empty: () => { expect(render(<ContinueLearning {...ready({ ...catalog, suggestions: { continue: null, nextLesson: null, reviewCandidates: [] } })} />)).toContain("No learning suggestion is available"); },
    suggested: () => { expect(render(<ContinueLearning {...ready(catalog)} />)).toContain(catalog.suggestions.continue!.reason); },
  },
  runStart: {
    quota: () => refusedStart(429, "Run quota reached. Try again later."),
    refused: () => refusedStart(403, "This attempt cannot be started."),
  },
};

function assertCoverage(inventory: Record<string, readonly string[]>, actual: Record<string, Record<string, unknown>>) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(inventory).sort());
  for (const [group, states] of Object.entries(inventory)) expect(Object.keys(actual[group]!).sort()).toEqual([...states].sort());
}
test("every declared learning view state has an executable test case", () => assertCoverage(LEARNING_VIEW_STATES, cases));
test("inventory gate rejects an added state without a test", () => {
  expect(() => assertCoverage({ ...LEARNING_VIEW_STATES, lab: [...LEARNING_VIEW_STATES.lab, "new-state"] }, cases)).toThrow();
});
test("inventory includes every learning route and existing Home/report learning surfaces", async () => {
  const source = ts.createSourceFile("App.tsx", await Bun.file(new URL("../src/app/App.tsx", import.meta.url)).text(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const paths: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === "path" && node.initializer && ts.isStringLiteral(node.initializer)) paths.push(node.initializer.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(paths.filter(path => path.startsWith("/learning")).sort()).toEqual(Object.keys(routes).filter(path => path.startsWith("/learning")).sort());
  for (const route of Object.keys(routes)) expect(paths).toContain(route);
  expect([...new Set<string>(Object.values(routes).flat())].sort()).toEqual(Object.keys(LEARNING_VIEW_STATES).sort());
});
for (const [route, groups] of Object.entries(routes)) for (const group of groups) {
  for (const [state, run] of Object.entries(cases[group])) test(`${route}: ${group}/${state}`, run);
}

test("learning components delegate selection, persistence and effects to data modules/hooks", async () => {
  const files = new Bun.Glob("*.tsx").scan(fileURLToPath(new URL("../src/features/learning/", import.meta.url)));
  const forbidden = new Set(["filter", "find", "findIndex", "findLast", "flatMap", "sort", "toSorted", "some", "every", "reduce", "useEffect", "useState", "useCallback", "useRef", "localStorage", "sessionStorage"]);
  for await (const file of files) {
    const text = await Bun.file(new URL(`../src/features/learning/${file}`, import.meta.url)).text();
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const found: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isIdentifier(node) && forbidden.has(node.text)) found.push(node.text);
      ts.forEachChild(node, visit);
    }
    visit(source); expect({ file, found }).toEqual({ file, found: [] });
  }
});
