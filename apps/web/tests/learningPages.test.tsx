import { expect, test } from "bun:test";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { LearningLessonDetail } from "@infraforge/contracts/learning";
import { Button } from "../src/ui/Button";
import { Field } from "../src/ui/Field";
import { LearningList, type LearningRequest } from "../src/features/learning/LearningPage";
import { LessonBody, LessonView } from "../src/features/learning/LessonPage";
import { LearningFocus } from "../src/features/learning/LearningFocus";
import { focusLearningHeading } from "../src/features/learning/navigationFocus";
import { ContinueLearning } from "../src/features/learning/ContinueLearning";
import { learningNextStep, nextStep, type HomeData } from "../src/features/dashboard/nextStep";
import { EMPTY_FILTERS, type LearningFilters } from "../src/features/learning/discovery";
import { readDeviceLesson, saveDeviceLesson, type DeviceLessonState } from "../src/features/learning/deviceLocal";
import { catalog, concept, lab, reading, attempted } from "./learningFixtures";
import { summary } from "./fixtures";

const render = (node: ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
const ready = <T,>(data: T): LearningRequest<T> => ({ data, loading: false, error: null, retry() {} });
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [child, ...elements(child.props.children as ReactNode)];
  });
}
const list = (filters = EMPTY_FILTERS) => render(<LearningList {...ready(catalog)} filters={filters} onFilters={() => {}} />);
const detail = (lesson = reading): LearningLessonDetail => ({ lesson, progress: null, challenge: lesson.kind === "executable-lab"
  ? { id: lesson.experiment.challengeId, version: 2, specHash: "a".repeat(64), title: "First production API", summary: "Try the design.", evaluationSeconds: 120, requirementCount: 4, executable: true } : null });
const bodyProps = (data = detail()) => ({ detail: data, catalog, local: { read: false, answer: null } as DeviceLessonState, storageAvailable: true,
  onLocal() {}, onOpen() {}, busy: false });

test("navigation focuses the page heading outside the Tab order and tolerates an unmounted page", () => {
  let focused = false;
  const heading = { tabIndex: 0, focus: () => { focused = true; } };
  const container = { querySelector: (selector: string) => { expect(selector).toBe("h1"); return heading; } };
  focusLearningHeading(container as unknown as HTMLElement);
  expect(focused).toBe(true); expect(heading.tabIndex).toBe(-1);
  expect(() => focusLearningHeading(null)).not.toThrow();
  expect(() => focusLearningHeading({ querySelector: () => null })).not.toThrow();
});

test("lesson focus follows loading, failure and lesson identity, without changing for progress updates", () => {
  const view = (data: LearningLessonDetail | null, loading = false, error: string | null = null) =>
    LessonView({ data, loading, error, retry() {}, catalog: ready(catalog) });
  const destinations = [view(null, true), view(null, false, "Missing"), view(detail(reading)), view(detail(concept))];
  expect(destinations.every((node) => node.type === LearningFocus)).toBe(true);
  expect(new Set(destinations.map((node) => node.props.destination)).size).toBe(4);
  expect(view({ ...detail(lab), progress: attempted }).props.destination).toBe(view(detail(lab)).props.destination);
});

test("learning controls have native keyboard semantics, associated labels and announced feedback", () => {
  const html = list();
  const labels = [...html.matchAll(/<label for="([^"]+)"[^>]*>([^<]+)/g)];
  expect(labels).toHaveLength(5);
  for (const [, id] of labels) expect(html).toMatch(new RegExp(`<(input|select)[^>]*id="${id}"`));
  const question = render(<LessonBody {...bodyProps(detail(concept))} />);
  expect(question).toContain(`<legend class="font-semibold">${concept.check!.question}</legend>`);
  for (const choice of concept.check!.choices) expect(question).toContain(`/>${choice.text}</label>`);
  for (const markup of [html, question]) {
    expect(markup).toContain('role="status"');
    expect(markup).not.toMatch(/tabindex="[1-9]/);
    expect(markup).not.toContain('role="application"');
  }
  const tree = elements(LessonBody(bodyProps(detail(concept))));
  expect(tree.some((e) => e.props.onKeyDown || e.props.onKeyUp)).toBe(false);
});

test("learning list renders track, module and lessons in order with honest kind labels", () => {
  const html = list();
  for (const phrase of ["Foundations", "Requests and routing", "Reading", "Concept check", "Runnable lab", "Conceptual only", "Available"]) expect(html).toContain(phrase);
  expect(html.indexOf("<h2")).toBeLessThan(html.indexOf("<h3"));
  expect(html.indexOf("What is a request?")).toBeLessThan(html.indexOf("DNS lookup"));
  expect(html.indexOf("DNS lookup")).toBeLessThan(html.indexOf("A database lab"));
  expect(html).not.toContain("Server activity:");
  expect(html).toContain('aria-describedby="learning-filter-help"');
});

test("actual filter and search handlers update the rendered results and clear resets all filters", () => {
  let filters: LearningFilters = { ...EMPTY_FILTERS };
  const tree = () => LearningList({ ...ready(catalog), filters, onFilters: (value) => { filters = value; } });
  const change = (label: string, value: string) => {
    const field = elements(tree()).find((e) => e.type === Field && e.props.label === label)!;
    const control = (field.props.children as (ids: { id: string }) => ReactElement<{ onChange(e: { target: { value: string } }): void }>)({ id: "test" });
    control.props.onChange({ target: { value } });
  };
  change("Kind", "conceptual-exercise");
  expect(list(filters)).toContain("DNS lookup"); expect(list(filters)).not.toContain("What is a request?");
  change("Search lessons", "database");
  expect(list(filters)).toContain("No lessons match");
  const clear = elements(tree()).find((e) => e.type === Button && e.props.children === "Clear filters")!;
  (clear.props.onClick as () => void)();
  change("Resource topic", "Database"); change("Level", "intermediate"); change("Track", "foundations");
  expect(list(filters)).toContain("A database lab"); expect(list(filters)).not.toContain("DNS lookup");
  expect(filters.search).toBe("");
});

test("loading, retry, empty list and lesson failure states are explicit", () => {
  expect(render(<LearningList {...ready(catalog)} loading filters={EMPTY_FILTERS} onFilters={() => {}} />)).toContain("Loading learning");
  let retries = 0;
  const failed = LearningList({ data: null, loading: false, error: "Offline", retry: () => { retries++; }, filters: EMPTY_FILTERS, onFilters() {} });
  expect(render(failed)).toContain("Offline");
  const failureComponent = failed as ReactElement<{ retry(): void }>;
  failureComponent.props.retry(); expect(retries).toBe(1);
  const empty = { ...catalog, tracks: [], lessons: [] };
  expect(render(<LearningList {...ready(empty)} filters={EMPTY_FILTERS} onFilters={() => {}} />)).toContain("No lessons are available yet");
  const failedLesson = render(<LessonView {...ready(detail())} data={null} error="Lesson not found" catalog={ready(catalog)} />);
  expect(failedLesson).toContain('role="alert"'); expect(failedLesson).toContain("Try again"); expect(failedLesson).toContain('href="/learn"');
  expect(render(<LessonView {...ready(detail())} loading catalog={ready(catalog)} />)).toContain("Loading lesson");
  expect(render(<ContinueLearning {...ready(catalog)} error="Offline" />)).toContain("learning suggestion could not be loaded");
  expect(render(<ContinueLearning {...ready(empty)} />)).toContain("No learning suggestion is available");
});

test("reading and concept pages expose no run claims and keep lesson sections in order", () => {
  for (const lesson of [reading, concept]) {
    const html = render(<LessonBody {...bodyProps(detail(lesson))} />);
    const headings = ["Problem", "Plain explanation", "Prediction prompt", "Limitations", "Follow-up", "Check question"];
    for (let i = 1; i < headings.length; i++) expect(html.indexOf(`>${headings[i - 1]}<`)).toBeLessThan(html.indexOf(`>${headings[i]}<`));
    for (const forbidden of ["Evidence to inspect", "Open challenge lab", "Server activity:", "Current requirements met"]) expect(html).not.toContain(forbidden);
    expect(html).toContain("saved on this device");
    expect(html).toContain("Prerequisites are advice");
  }
});

test("check selection gives an immediate explanation, and read marks remain local when storage throws", () => {
  let local: DeviceLessonState = { read: false, answer: null }, available = true;
  const denied = () => { throw Error("Storage denied"); };
  const props = () => ({ ...bodyProps(detail(concept)), local, storageAvailable: available, onLocal: (value: DeviceLessonState) => {
    local = value; available = saveDeviceLesson(concept.id, 1, value, denied);
  } });
  const choose = (value: string) => {
    const radio = elements(LessonBody(props())).find((e) => e.type === "input" && e.props.value === value)!;
    (radio.props.onChange as () => void)();
  };
  choose("note");
  expect(render(<LessonBody {...props()} />)).toContain(`Revisit the explanation.`);
  expect(render(<LessonBody {...props()} />)).toContain(concept.check!.explanation);
  choose("address");
  const mark = elements(LessonBody(props())).find((e) => e.type === Button && e.props.children === "Mark as read")!;
  (mark.props.onClick as () => void)();
  expect(local).toEqual({ read: true, answer: "address" });
  const html = render(<LessonBody {...props()} />);
  expect(html).toContain("That matches the explanation"); expect(html).toContain("Could not save on this device");
  expect(html).toContain('aria-pressed="true"'); expect(html).not.toContain("Server activity:");
  expect(readDeviceLesson(concept.id, 1, denied).value.read).toBe(false);
});

test("lab's single launch action opens exactly its linked challenge and refuses unavailable links", () => {
  let opened = "";
  const props = { ...bodyProps(detail(lab)), onOpen: (id: string) => { opened = id; } };
  const tree = LessonBody(props), html = render(tree);
  const launch = elements(tree).find((e) => e.type === Button && e.props.children === "Open challenge lab")!;
  (launch.props.onClick as () => void)();
  expect(opened).toBe("first-production-api");
  expect(html.indexOf(">Experiment<")).toBeLessThan(html.indexOf(">Evidence to inspect<"));
  expect(html.indexOf(">Evidence to inspect<")).toBeLessThan(html.indexOf(">Limitations<"));
  expect(html).toContain(lab.experiment!.prediction!); expect(html).toContain("No outcome is claimed");
  for (const challenge of [null, { ...props.detail.challenge!, executable: false }, { ...props.detail.challenge!, id: "wrong" }]) {
    const unavailable = render(<LessonBody {...props} detail={{ ...props.detail, challenge }} />);
    expect(unavailable).not.toContain("Open challenge lab"); expect(unavailable).toContain("unavailable for running");
  }
  const recorded = render(<LessonBody {...props} detail={{ ...props.detail, progress: attempted }} />);
  expect(recorded).toContain("Server activity: Recorded attempt"); expect(recorded).toContain('href="/runs/run-1"');
});

test("Home keeps existing recommendation priorities and uses server continue before nextLesson", () => {
  const next = { lessonId: concept.id, reason: "Server next reason" };
  expect(learningNextStep({ ...catalog, suggestions: { ...catalog.suggestions, nextLesson: next } })?.lesson.id).toBe(reading.id);
  expect(learningNextStep({ ...catalog, suggestions: { ...catalog.suggestions, continue: null, nextLesson: next } })).toEqual({ lesson: concept, reason: next.reason });
  expect(learningNextStep({ ...catalog, suggestions: { ...catalog.suggestions, continue: { lessonId: "missing", reason: "Unavailable" }, nextLesson: next } })?.lesson.id).toBe(concept.id);
  expect(learningNextStep(null)).toBeNull();
  const base: HomeData = { live: [], runs: [], designs: [], challenges: [summary] };
  expect(nextStep(base).kind).toBe("start");
  expect(render(<ContinueLearning {...ready(catalog)} />)).toContain(catalog.suggestions.continue!.reason);
  expect(nextStep({ ...base, challenges: [{ ...summary, workspaceDesignId: "workspace" }] }).kind).toBe("continue");
});

test("lab pages show the authored evidence checklist and follow-up in lesson order", () => {
  const authored = { ...lab, kind: "executable-lab" as const, followUp: "Explain which observations would contradict your prediction.",
    experiment: { ...lab.experiment!, evidenceToInspect: ["Inspect the recorded application CPU.", "Compare completed requests over the stated interval."] } };
  const html = render(<LessonBody {...bodyProps(detail(authored))} />);
  for (const item of authored.experiment.evidenceToInspect) expect(html).toContain(item);
  expect(html).toContain(authored.followUp);
  expect(html.indexOf(authored.experiment.evidenceToInspect[0]!)).toBeLessThan(html.indexOf(">Limitations<"));
  expect(html.indexOf(authored.followUp)).toBeGreaterThan(html.indexOf(">Limitations<"));
  expect(html.indexOf(authored.followUp)).toBeLessThan(html.indexOf(">Check question<"));
});
