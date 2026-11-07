import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { LearningCatalog, LearningLessonDetail } from "@infraforge/contracts/learning";
import { API_URL, http } from "../src/client/httpClient";
import { getLearningCatalog, getLearningLesson } from "../src/features/learning/learning.api";
import { ContinueLearning } from "../src/features/learning/ContinueLearning";
import { LearningList } from "../src/features/learning/LearningPage";
import { LessonBody } from "../src/features/learning/LessonPage";
import { availableLessons, discoverLessons, EMPTY_FILTERS } from "../src/features/learning/discovery";

interface WebProof {
  foundations: LearningCatalog; reading: LearningLessonDetail; concept: LearningLessonDetail;
  attemptedCatalog: LearningCatalog; lab: LearningLessonDetail;
  curriculumDetails: LearningLessonDetail[]; curriculumRecall: LearningCatalog;
}

// The child uses the production router, session middleware, registry, progress
// derivation and real-engine attempts. Its DB/session lookups are isolated stand-ins.
// The web adapter below replays those HTTP payloads, not authored activity verdicts.
test("real learning API payloads drive foundations, checks, a linked lab and Home's continue reason", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("../../backend/tests/fixtures/learningRoutes.ts", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  const proof = (JSON.parse(stdout) as { webProof: WebProof }).webProof;
  const adapter = http.defaults.adapter;
  let catalog = proof.foundations;
  const requests: string[] = [];
  http.defaults.adapter = async (config) => {
    expect(config.withCredentials).toBe(true);
    requests.push(config.url!);
    const data = config.url === `${API_URL}/learning` ? catalog
      : config.url === `${API_URL}/learning/lessons/what-is-a-request` ? proof.reading
        : config.url === `${API_URL}/learning/lessons/client-and-server` ? proof.concept
          : config.url === `${API_URL}/learning/lessons/api-lab` ? proof.lab
            : proof.curriculumDetails.find(detail => config.url === `${API_URL}/learning/lessons/${detail.lesson.id}`) ?? null;
    if (!data) throw Error("Not found");
    return { data, status: 200, statusText: "OK", headers: {}, config };
  };
  const render = (node: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>).replaceAll("&#x27;", "'");
  const ready = <T,>(data: T) => ({ data, loading: false, error: null, retry() {} });
  const lesson = (data: LearningLessonDetail, answer: string | null = null) => render(<LessonBody detail={data} catalog={catalog}
    local={{ read: false, answer }} storageAvailable onLocal={() => {}} onOpen={() => {}} busy={false} />);
  try {
    const foundations = await getLearningCatalog();
    const html = render(<LearningList {...ready(foundations)} filters={EMPTY_FILTERS} onFilters={() => {}} />);
    expect(html).toContain("Track 1: Foundations"); expect(html).toContain("What is a request?"); expect(html).toContain("Client and server");
    expect(foundations.tracks.map(track => track.id)).toEqual(["foundations", "scaling", "data", "async", "failures", "missions", "depth", "advanced", "architecture", "diagnosis"]);
    expect(availableLessons(foundations)).toHaveLength(foundations.lessons.length);
    for (const track of foundations.tracks) {
      expect(html).toContain(track.title);
      for (const level of ["beginner", "intermediate", "advanced"] as const) {
        for (const kind of ["reading", "conceptual-exercise", "executable-lab"] as const) {
          const filters = { ...EMPTY_FILTERS, track: track.id, level, kind };
          const expected = availableLessons(foundations).filter(l => l.trackId === track.id && l.level === level && l.kind === kind);
          expect(discoverLessons(foundations, filters)).toEqual(expected);
          const filtered = render(<LearningList {...ready(foundations)} filters={filters} onFilters={() => {}} />);
          for (const candidate of expected) expect(filtered).toContain(`href="/learn/lessons/${candidate.id}"`);
          if (!expected.length) expect(filtered).toContain("No lessons match");
        }
      }
    }
    const scaling = foundations.tracks.find(track => track.id === "scaling")!;
    expect(scaling.modules[0]!.lessonIds).toEqual(["up-or-out", "choose-the-constrained-tier"]);
    const scalingReading = await getLearningLesson("up-or-out");
    expect(scalingReading).toMatchObject({lesson: {kind: "reading", level: "beginner", check: null}, challenge: null, progress: null});
    expect(lesson(scalingReading)).toContain("Scaling out adds machines");
    expect(lesson(scalingReading)).toContain('href="/learn/lessons/choose-the-constrained-tier"');
    const scalingExercise = await getLearningLesson("choose-the-constrained-tier");
    expect(scalingExercise).toMatchObject({lesson: {kind: "conceptual-exercise", level: "beginner"}, challenge: null, progress: null});
    expect(lesson(scalingExercise, "apps")).toContain("Revisit the explanation.");
    expect(lesson(scalingExercise, "database")).toContain("That matches the explanation.");
    expect(lesson(scalingExercise)).toContain('href="/learn/lessons/load-balancer-policies"');
    for (const detail of proof.curriculumDetails) {
      const loaded = await getLearningLesson(detail.lesson.id);
      const markup = lesson(loaded);
      expect(markup).toContain("Prerequisites are advice");
      for (const id of loaded.lesson.prerequisites) expect(markup).toContain(`href="/learn/lessons/${id}"`);
      if (loaded.lesson.trackId === "foundations" || loaded.lesson.kind === "executable-lab") continue;
      expect(loaded.challenge).toBeNull(); expect(loaded.progress).toBeNull();
      for (const forbidden of ["Evidence to inspect", "Open challenge lab", "Server activity:"]) expect(markup).not.toContain(forbidden);
      if (!loaded.lesson.check) {
        expect(loaded.lesson.kind).toBe("reading");
        expect(markup).toContain("This lesson has no check question");
        continue;
      }
      const check = loaded.lesson.check!;
      expect(detail.lesson.check).toEqual(check);
      const wrong = check.choices.find(choice => choice.id !== check.correctChoiceId)!;
      expect(lesson(loaded, wrong.id)).toContain("Revisit the explanation.");
      const checkedConcept = lesson(loaded, check.correctChoiceId);
      expect(checkedConcept).toContain("That matches the explanation.");
      expect(checkedConcept).toContain(check.explanation.replaceAll("&", "&amp;"));
      for (const forbidden of ["Evidence to inspect", "Open challenge lab", "Server activity:"]) expect(checkedConcept).not.toContain(forbidden);
    }
    const recall = proof.curriculumRecall;
    const recallMarkup = render(<LearningList {...ready(recall)} filters={EMPTY_FILTERS} onFilters={() => {}} />);
    expect(recallMarkup).toContain("Worth revisiting");
    expect(recallMarkup).toContain(recall.suggestions.reviewCandidates[0]!.reason);
    expect(recallMarkup).toContain("Concepts to revisit for this lab (advice):");
    for (const id of ["load-balancer-policies", "percentiles-and-populations"]) expect(recallMarkup).toContain(`href="/learn/lessons/${id}"`);
    const reading = await getLearningLesson("what-is-a-request");
    expect(lesson(reading)).toContain(reading.lesson.explanation[0]!);
    expect(lesson(reading)).not.toContain("Server activity:"); expect(lesson(reading)).not.toContain("Evidence to inspect");
    const concept = await getLearningLesson("client-and-server");
    const checked = lesson(concept, concept.lesson.check!.correctChoiceId);
    expect(checked).toContain(concept.lesson.check!.explanation); expect(checked).toContain("saved on this device");
    catalog = proof.attemptedCatalog;
    const active = await getLearningCatalog();
    expect(active.progress.find((p) => p.lessonId === "api-lab")?.activity).toBe("attempted");
    const home = render(<ContinueLearning {...ready(active)} />);
    expect(home).toContain("Continue learning"); expect(home).toContain('href="/learn/lessons/api-lab"');
    expect(home).toContain(active.suggestions.continue!.reason);
    expect(active.suggestions.continue!.reason).toContain("run run-1");
    const lab = await getLearningLesson("api-lab");
    expect(lab.lesson.experiment?.challengeId).toBe("first-production-api");
    expect(lab.challenge?.id).toBe(lab.lesson.experiment!.challengeId);
    expect(lesson(lab)).toContain("Open challenge lab"); expect(lesson(lab)).toContain('href="/runs/run-1"');
    await expect(getLearningLesson("missing / lesson")).rejects.toThrow("Not found");
    expect(requests.at(-1)).toBe(`${API_URL}/learning/lessons/missing%20%2F%20lesson`);
  } finally { http.defaults.adapter = adapter; }
}, 180000);
