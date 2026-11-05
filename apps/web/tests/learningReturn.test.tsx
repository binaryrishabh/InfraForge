import { expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { API_URL, http } from "../src/client/httpClient";
import { ReportLessonContent } from "../src/features/learning/ReportLesson";
import { findReportLesson } from "../src/features/learning/reportLessonData";
import { LearningList } from "../src/features/learning/LearningPage";
import { EMPTY_FILTERS } from "../src/features/learning/discovery";
import { catalog, concept, lab } from "./learningFixtures";

const render = (node: ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
const ready = <T,>(data: T | null) => ({ data, loading: false, error: null, retry() {} });

test("report lesson lookup returns only a visible linked lab and preserves its authored follow-up", async () => {
  const adapter = http.defaults.adapter;
  const lesson = { ...lab, followUp: "Change one setting and inspect the next recorded result." };
  const detail = { lesson, progress: null, challenge: null };
  const requests: string[] = [];
  http.defaults.adapter = async (config) => {
    expect(config.withCredentials).toBe(true);
    requests.push(config.url!);
    return { data: config.url === `${API_URL}/learning` ? catalog : detail, config, status: 200, statusText: "OK", headers: {} };
  };
  try {
    const found = await findReportLesson("first-production-api");
    const html = render(<ReportLessonContent {...ready(found)} />);
    expect(html).toContain("Part of lesson A database lab");
    expect(html).toContain('href="/learn/lessons/api-lab"');
    expect(html).toContain(lesson.followUp);
    expect(await findReportLesson("unlinked-challenge")).toBeNull();
    expect(requests.filter((url) => url.includes("/lessons/")).length).toBe(1);
    expect(render(<ReportLessonContent {...ready(null)} />)).toBe("");
    const failure = render(<ReportLessonContent {...ready(null)} error="Follow-up unavailable" />);
    expect(failure).toContain("Follow-up unavailable"); expect(failure).toContain("Try again");
  } finally { http.defaults.adapter = adapter; }
});

test("Learning shows the server's factual review reasons and hides suggestions for unavailable lessons", () => {
  const reason = "1 recorded attempt; no requirements-met result for the current challenge version.";
  const data = { ...catalog, suggestions: { ...catalog.suggestions, reviewCandidates: [
    { lessonId: lab.id, reason }, { lessonId: "hidden", reason: "Must never appear" },
  ] } };
  const html = render(<LearningList {...ready(data)} filters={EMPTY_FILTERS} onFilters={() => {}} />);
  expect(html).toContain("Worth revisiting"); expect(html).toContain(reason);
  expect(html).toContain("Concepts to revisit for this lab (advice):");
  expect(html).toContain(`href="/learn/lessons/${concept.id}"`);
  expect(html).not.toContain("Must never appear");
  const changedVersion = "An earlier challenge version met its requirements; current version 2 has no requirements-met attempt.";
  const updated = { ...catalog, suggestions: { ...catalog.suggestions, reviewCandidates: [{ lessonId: lab.id, reason: changedVersion }] } };
  expect(render(<LearningList {...ready(updated)} filters={EMPTY_FILTERS} onFilters={() => {}} />)).toContain(changedVersion);
  expect(render(<LearningList {...ready(catalog)} filters={EMPTY_FILTERS} onFilters={() => {}} />)).not.toContain("Worth revisiting");
  const hidden = { ...data, lessons: data.lessons.map(lesson => lesson.id === concept.id ? { ...lesson, availability: "draft" as const } : lesson) };
  const hiddenHtml = render(<LearningList {...ready(hidden)} filters={EMPTY_FILTERS} onFilters={() => {}} />);
  expect(hiddenHtml).toContain(reason);
  expect(hiddenHtml).not.toContain(`href="/learn/lessons/${concept.id}"`);
  expect(hiddenHtml).not.toContain("Concepts to revisit for this lab (advice):");
});
