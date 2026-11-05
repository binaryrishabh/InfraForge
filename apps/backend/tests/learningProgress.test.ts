import { describe, expect, test } from "bun:test";
import { selectLearningSuggestions } from "@infraforge/contracts/learning";
import { deriveLessonProgress } from "../learning/progress";
import { buildLearningRegistry } from "../learning/registry";
import { learningAttempt } from "../challenges/history";
import { classifyComparison } from "../comparison/classify";
import { progressAttempt, progressContent } from "./learningFixtures";

const registry = buildLearningRegistry(progressContent()), lessons = registry.listLessons(), tracks = registry.listTracks();
const derive = (rows: Parameters<typeof deriveLessonProgress>[2], owner = "alice") => deriveLessonProgress(owner, lessons, rows);
const api = (rows: Parameters<typeof derive>[0]) => derive(rows).find((p) => p.lessonId === "api-lab")!;
const later = { id: "run-2", createdAt: new Date("2026-11-02T00:00:00Z"), updatedAt: new Date("2026-11-02T00:01:00Z") };

test("no evidence means no progress; reading and conceptual exercises have no server completion", () => {
  const result = derive([]);
  expect(result).toHaveLength(2);
  expect(api([])).toEqual({ lessonId: "api-lab", challengeId: "first-production-api", currentChallengeVersion: 2,
    activity: "not-started", attempts: 0, predictionReviewed: false, sameConditionsComparison: false,
    lastRunId: null, lastAttemptAt: null, lastActivityAt: null, fromEarlierVersion: false, earlierVersionRequirementsMet: false, improvement: null });
  const concept = registry.findLesson("intro")!;
  expect(deriveLessonProgress("alice", [{ ...concept, kind: "conceptual-exercise", experiment: null,
    check: { question: "Why?", choices: [], correctChoiceId: "a", explanation: "Test fixture" } }], [])).toEqual([]);
});

test("real attempts are counted and evaluated without a recent-attempt window or prediction correctness score", () => {
  const met = progressAttempt("two"), notMet = progressAttempt();
  expect(learningAttempt(met).status).toBe("met");
  expect(learningAttempt(notMet).status).toBe("not-met");
  const failed = Array.from({ length: 24 }, (_, i) => ({ ...notMet, id: `later-${i}`, createdAt: later.createdAt, updatedAt: later.updatedAt }));
  expect(api([met, ...failed])).toMatchObject({ activity: "requirements-met", attempts: 25,
    predictionReviewed: true, sameConditionsComparison: true, lastRunId: "later-9", lastActivityAt: later.updatedAt.toISOString() });
  // A wrong prediction never erases a requirements-met attempt.
  expect(learningAttempt(met).predictionMatched).toBeLessThan(learningAttempt(met).predictionTotal);
}, 60000);

describe("missing or unfinished evidence is never requirements-met", () => {
  const cases = [
    ["active runtime", { runtimeActive: true }], ["active status", { status: "browser" }],
    ["no terminal", { terminalSnapshot: null }], ["no prediction", { challengePrediction: null }],
    ["wrong pin", { challengeSpecHash: "0".repeat(64) }], ["unknown version", { challengeVersion: 99 }],
    ["no gates", { stages: [] }],
  ] as const;
  for (const [name, change] of cases) test(name, () => {
    const row = progressAttempt("two", change);
    expect(api([row])).toMatchObject({ activity: "attempted", attempts: 1, predictionReviewed: false, sameConditionsComparison: false });
  }, 60000);
  test("an unjudged static failure is activity without a reviewed prediction claim", () => {
    const row = progressAttempt("one", { terminalSnapshot: null, status: "pending" });
    expect(api([row])).toMatchObject({ activity: "attempted", predictionReviewed: false });
  });
});

test("owner filtering precedes evaluation, lineage, comparison and latest activity", () => {
  const alice = progressAttempt(), bob = progressAttempt("two", { ...later, ownerId: "bob", improvementSourceId: alice.id,
    learningIntent: "improvement", learningHypothesis: "More servers may change the result." });
  expect(api([bob, alice])).toMatchObject({ activity: "attempted", attempts: 1, lastRunId: alice.id, sameConditionsComparison: false, improvement: null });
  expect(derive([bob, alice], "bob").find((p) => p.lessonId === "api-lab")).toMatchObject({ activity: "requirements-met", attempts: 1, lastRunId: bob.id });
  expect(derive([bob, alice], "charlie")).toEqual(derive([]));
  expect(api([{ ...bob, ownerId: null }])).toMatchObject({ activity: "not-started", attempts: 0 });
});

test("earlier pinned results remain activity and review candidates, not current requirements-met", () => {
  const old = progressAttempt("earlier");
  expect(learningAttempt(old)).toMatchObject({ version: 1, status: "met" });
  const progress = derive([old]);
  expect(progress.find((p) => p.lessonId === "api-lab")).toMatchObject({ activity: "attempted", fromEarlierVersion: true, earlierVersionRequirementsMet: true });
  expect(selectLearningSuggestions(tracks, lessons, progress).reviewCandidates[0]?.reason).toContain("current version 2");
  expect(api([old, progressAttempt("two", later)])).toMatchObject({ activity: "requirements-met", attempts: 2,
    fromEarlierVersion: true, earlierVersionRequirementsMet: true, sameConditionsComparison: false });
}, 60000);

test("same-conditions flags use the existing classifier and never cross challenge versions or active runs", () => {
  const first = progressAttempt(), same = progressAttempt("two", later);
  expect(classifyComparison(first, same).challengeConditions).toBe("same");
  expect(api([first, same]).sameConditionsComparison).toBe(true);
  const changed = { ...same, seed: "other", runInputs: { ...(same.runInputs as object), seed: "other" } };
  expect(classifyComparison(first, changed).challengeConditions).toBe("different");
  expect(api([first, changed]).sameConditionsComparison).toBe(false);
  expect(api([first, { ...same, runtimeActive: true }]).sameConditionsComparison).toBe(false);
  // Conditions can be known while results are unknown. This flag never claims an evaluated outcome.
  const missing = [{ ...same, id: first.id, createdAt: first.createdAt, terminalSnapshot: null }, { ...same, terminalSnapshot: null }];
  expect(classifyComparison(missing[0]!, missing[1]!).challengeConditions).toBe("same");
  expect(api(missing)).toMatchObject({ activity: "attempted", sameConditionsComparison: true, predictionReviewed: false });
  const otherChallenge = { ...same, challengeId: "cache-matters" };
  expect(api([first, otherChallenge]).sameConditionsComparison).toBe(false);
});

test("improved-after-attempt requires a real evaluated improvement and more met requirements under the same conditions", () => {
  const source = progressAttempt("expensive"), better = progressAttempt("one", { ...later, improvementSourceId: source.id,
    learningIntent: "improvement", learningHypothesis: "A smaller database may meet the cost requirement." });
  expect(learningAttempt(source).metCount).toBeLessThan(learningAttempt(better).metCount);
  expect(learningAttempt(better).status).toBe("not-met");
  expect(api([source, better])).toMatchObject({ activity: "improved-after-attempt", improvement: { sourceRunId: source.id, runId: better.id } });
  for (const change of [{ learningIntent: "repeat" }, { improvementSourceId: "missing" }, { learningHypothesis: null }, { runtimeActive: true },
    { runInputs: { ...(better.runInputs as object), seed: "different" } }, { createdAt: new Date(0) }]) {
    expect(api([source, { ...better, ...change }]).activity).toBe("attempted");
  }
  expect(api([source, { ...source, ...later, improvementSourceId: source.id, learningIntent: "improvement", learningHypothesis: "No score increase" }]).activity).toBe("attempted");
  expect(api([source, { ...better, ownerId: "bob" }]).improvement).toBeNull();
}, 60000);

test("last attempt and last saved activity are distinct, deterministic and do not mutate rows", () => {
  const old = progressAttempt("one", { updatedAt: new Date("2026-11-03T00:00:00Z") });
  const recent = progressAttempt("one", later), rows = [recent, old], before = structuredClone(rows);
  expect(api(rows)).toMatchObject({ lastRunId: recent.id, lastAttemptAt: recent.createdAt.toISOString(), lastActivityAt: old.updatedAt.toISOString() });
  expect(api([old, recent])).toEqual(api(rows));
  expect(rows).toEqual(before);
});

test("next follows track/module order and at-least-attempted/read prerequisites; marks stay device-local", () => {
  const empty = derive([]), read = new Set(["intro"]);
  expect(selectLearningSuggestions(tracks, lessons, empty).nextLesson?.lessonId).toBe("intro");
  expect(selectLearningSuggestions(tracks, lessons, empty, read).nextLesson?.lessonId).toBe("api-lab");
  const attempted = derive([progressAttempt()]);
  expect(selectLearningSuggestions(tracks, lessons, attempted, read).nextLesson?.lessonId).toBe("api-lab");
  const met = derive([progressAttempt("two")]);
  expect(selectLearningSuggestions(tracks, lessons, met, read).nextLesson?.lessonId).toBe("cache-lab");
  // A missing reading prerequisite affects suggestions, never the lesson lookup.
  expect(registry.findLesson("cache-lab")).not.toBeNull();
  expect(selectLearningSuggestions(tracks, lessons.filter((l) => l.id !== "intro"), empty).nextLesson).toBeNull();
  expect(empty.some((p) => p.lessonId === "intro")).toBe(false);
  expect(selectLearningSuggestions(tracks, lessons, met, read).reviewCandidates).toEqual([]);
});

test("continue uses the most recent real attempt, then next when that lesson is met, with factual reasons", () => {
  const first = progressAttempt(), second = progressAttempt("two", later);
  expect(selectLearningSuggestions(tracks, lessons, derive([first])).continue).toMatchObject({ lessonId: "api-lab", reason: expect.stringContaining(first.id) });
  const met = selectLearningSuggestions(tracks, lessons, derive([first, second]));
  expect(met.continue).toEqual(met.nextLesson);
  const cache = { ...first, ...later, challengeId: "cache-matters" };
  const suggestions = selectLearningSuggestions(tracks, lessons, derive([first, cache]));
  expect(suggestions.continue?.lessonId).toBe("cache-lab");
  expect(suggestions.reviewCandidates.map((c) => c.lessonId)).toEqual(["api-lab", "cache-lab"]);
  expect(suggestions.reviewCandidates.every((c) => c.reason.includes("recorded attempt"))).toBe(true);
});

test("suggestions exclude draft lessons, modules and tracks and return null when the path is exhausted", () => {
  const content = progressContent(), progress = derive([progressAttempt("two")]);
  expect(selectLearningSuggestions(content.tracks.map((t) => ({ ...t, availability: "draft" })), content.lessons, progress)).toEqual({ nextLesson: null, continue: null, reviewCandidates: [] });
  const hidden = content.tracks.map((t) => ({ ...t, modules: t.modules.map((m) => ({ ...m, availability: "draft" as const })) }));
  expect(selectLearningSuggestions(hidden, content.lessons, progress).nextLesson).toBeNull();
  const onlyIntro = lessons.filter((l) => l.id === "intro");
  expect(selectLearningSuggestions(tracks, onlyIntro, [], new Set(["intro"]))).toEqual({ nextLesson: null, continue: null, reviewCandidates: [] });
});
