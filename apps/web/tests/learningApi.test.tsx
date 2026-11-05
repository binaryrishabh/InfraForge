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
import { EMPTY_FILTERS } from "../src/features/learning/discovery";

interface WebProof {
  foundations: LearningCatalog; reading: LearningLessonDetail; concept: LearningLessonDetail;
  attemptedCatalog: LearningCatalog; lab: LearningLessonDetail;
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
          : config.url === `${API_URL}/learning/lessons/api-lab` ? proof.lab : null;
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
    expect(home).toContain("Continue learning"); expect(home).toContain('href="/learning/lessons/api-lab"');
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
