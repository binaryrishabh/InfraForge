// Run in a child process so the session-provider stand-in cannot affect other auth tests.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { buildLearningRegistry } from "../../learning/registry";
import { progressAttempt, progressContent } from "../learningFixtures";
import { readLearningAttempts, type LearningAttemptDatabase, type LearningAttemptQuery } from "../../learning/attempts";
import type { LearningCatalog, LearningLessonDetail } from "@infraforge/contracts/learning";
import type { LearningRun } from "../../learning/progress";
import { definition, attemptRow, answers, tier } from "../challengeHarness";
import { buildRunReport } from "../../reports/report";

let sessionReads = 0;
mock.module("../../auth/auth", () => ({ authSettings: { origins: ["http://localhost"] }, auth: { api: {
  getSession: async ({ headers, query }: { headers: Headers; query: { disableCookieCache: boolean } }) => {
    sessionReads++;
    assert.equal(query.disableCookieCache, true);
    const cookie = headers.get("cookie");
    return cookie === "fixture=alice" ? { user: { id: "alice" } } : cookie === "fixture=bob" ? { user: { id: "bob" } } : null;
  },
} } }));
const { requireSession } = await import("../../auth/httpSecurity");
const { createLearningRouter } = await import("../../learning/routes");
const content = progressContent();
const current = content.lessons.find((l) => l.id === "api-lab")!;
const historical = structuredClone(current);
current.contentVersion = 2;
content.archivedLessons = [historical];
const registry = buildLearningRegistry(content);
let rows: LearningRun[] = [], queries: LearningAttemptQuery[] = [];
let unavailable = false;
const database: LearningAttemptDatabase = { deployment: {
  findMany: async (query) => {
    if (unavailable) throw Error("Attempt storage unavailable");
    queries.push(query);
    assert.equal(query.select.ownerId, true);
    assert.deepEqual(query.select.actions, { orderBy: { sequence: "asc" }, take: 501 });
    // Honour the actual production reader's where clause; a missing owner predicate fails here.
    return rows.filter((r) => r.ownerId === query.where.ownerId && query.where.challengeId.in.includes(r.challengeId!))
      .map((r) => ({ ...r, _count: { actions: r.actions?.length ?? 0 } }));
  },
} };
const app = express();
app.use("/api/learning", requireSession);
app.use("/api/learning", createLearningRouter({ registry, readAttempts: (ownerId, ids) => readLearningAttempts(ownerId, ids, database) }));
// Actual curriculum content for the web proof; stored attempt/session lookups remain fixture seams.
let publishedRows: LearningRun[] = [];
app.use("/api/foundations", requireSession, createLearningRouter({ readAttempts: async () => publishedRows }));
app.use((error: Error & { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(error.statusCode ?? 500).json({ message: error.message });
});
const server = app.listen(0, "127.0.0.1");
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/learning`;
async function get(path = "", owner = "alice", status = 200) {
  const response = await fetch(base + path, { headers: { cookie: `fixture=${owner}` } });
  assert.equal(response.status, status);
  return response.json();
}
const catalog = async (owner = "alice") => await get("", owner) as LearningCatalog;
const progress = async (owner = "alice") => (await catalog(owner)).progress.find((p) => p.lessonId === "api-lab")!;

try {
  for (const path of ["", "/lessons/api-lab", "/lessons/intro", "/lessons/missing", "/lessons/draft-lab"]) await get(path, "anonymous", 401);
  assert.equal(queries.length, 0);
  const initial = await catalog();
  assert.equal(initial.progress.length, 2);
  assert.equal(initial.progress.find((p) => p.lessonId === "api-lab")!.activity, "not-started");
  assert.equal(initial.suggestions.nextLesson?.lessonId, "intro");
  assert.ok(initial.lessons.every((l) => l.id !== "draft-lab" && !("explanation" in l)));
  assert.ok(initial.tracks.every((t) => t.modules.every((m) => !m.lessonIds.includes("draft-lab"))));
  const read = await get("/lessons/intro") as LearningLessonDetail;
  const unattemptedLab = await get("/lessons/api-lab") as LearningLessonDetail;
  assert.equal(read.progress, null); assert.equal(read.challenge, null);
  const count = queries.length;
  await get("/lessons/missing", "alice", 404);
  await get("/lessons/draft-lab", "alice", 404);
  assert.equal(queries.length, count);

  // These are engine-produced rows from the existing challenge harness, not hand-authored verdicts.
  const failed = progressAttempt("one"), met = progressAttempt("two", { id: "run-2", createdAt: new Date("2026-11-02T00:00:00Z"), updatedAt: new Date("2026-11-02T00:01:00Z"),
    improvementSourceId: failed.id, learningIntent: "improvement", learningHypothesis: "A second server may meet the server-count requirement." });
  rows = [{ ...failed, status: "browser", runtimeActive: true, terminalSnapshot: null }];
  assert.equal((await progress()).activity, "attempted");
  assert.equal((await progress()).predictionReviewed, false);
  rows = [failed];
  assert.equal((await progress()).activity, "attempted");
  assert.equal((await progress()).predictionReviewed, true);
  assert.equal((await progress()).attempts, 1);
  assert.equal((await catalog()).suggestions.continue?.lessonId, "api-lab");
  const attemptedCatalog = await catalog();
  const failedLab = await get("/lessons/api-lab") as LearningLessonDetail;
  const failedReport = buildRunReport(failed);
  assert.equal(failedReport.challenge?.status, "not-met");

  // A real engine run stopped before evaluation, with persisted failed status.
  // The report, not this fixture, decides which outcomes remain unknown.
  const blockedDefinition = definition("first-production-api");
  const blocked = { ...attemptRow(blockedDefinition, tier(2), answers(blockedDefinition, { health: "healthy", busiest: "Database" }), { stopAt: 0, status: "failed" }), ownerId: "alice" };
  rows = [blocked];
  const blockedLab = await get("/lessons/api-lab") as LearningLessonDetail;
  const blockedReport = buildRunReport(blocked);
  assert.equal(blockedReport.challenge?.status, "not-evaluated");
  rows = [failed];

  // Bob's passing run cannot meet Alice's requirements or establish her comparison/lineage.
  rows.push({ ...met, ownerId: "bob" });
  assert.equal((await progress()).activity, "attempted");
  assert.equal((await progress()).attempts, 1);
  assert.equal((await progress()).sameConditionsComparison, false);
  assert.equal((await progress("bob")).activity, "requirements-met");
  const detail = await get("/lessons/api-lab?version=1&ownerId=bob") as LearningLessonDetail;
  assert.equal(detail.lesson.contentVersion, 2);
  assert.equal(detail.progress?.attempts, 1);
  assert.equal(detail.progress?.lastRunId, failed.id);
  assert.equal(detail.challenge?.id, "first-production-api");
  assert.equal(detail.challenge?.version, 2);
  assert.equal(detail.challenge?.requirementCount, 4);
  assert.ok(detail.challenge?.specHash.match(/^[a-f0-9]{64}$/));

  rows.push(met);
  assert.equal((await progress()).activity, "requirements-met");
  assert.equal((await progress()).attempts, 2);
  assert.equal((await progress()).sameConditionsComparison, true);
  assert.equal((await progress()).improvement?.sourceRunId, failed.id);
  assert.equal((await catalog()).suggestions.reviewCandidates.length, 0);
  // Detail and catalog share one derivation and cannot diverge.
  assert.deepEqual((await get("/lessons/api-lab") as LearningLessonDetail).progress, await progress());

  const older = progressAttempt("earlier");
  rows = [older];
  assert.equal((await progress()).activity, "attempted");
  assert.equal((await progress()).fromEarlierVersion, true);
  assert.equal((await progress()).earlierVersionRequirementsMet, true);
  assert.ok((await catalog()).suggestions.reviewCandidates[0]?.reason.includes("current version 2"));
  const staleCatalog = await catalog();
  const staleLab = await get("/lessons/api-lab") as LearningLessonDetail;
  assert.equal((await progress("bob")).activity, "not-started");
  assert.ok(queries.every((q) => q.where.ownerId === "alice" || q.where.ownerId === "bob"));

  // Defense in depth: even a faulty reader returning another owner's rows cannot expose progress.
  const mixedApp = express(); mixedApp.use(requireSession);
  mixedApp.use(createLearningRouter({ registry, readAttempts: async () => [failed, { ...met, ownerId: "bob" }] }));
  const mixedServer = mixedApp.listen(0, "127.0.0.1");
  try {
    const response = await fetch(`http://127.0.0.1:${(mixedServer.address() as AddressInfo).port}/lessons/api-lab`, { headers: { cookie: "fixture=alice" } });
    assert.equal(response.status, 200);
    const data = await response.json() as LearningLessonDetail;
    assert.equal(data.progress?.attempts, 1);
    assert.equal(data.progress?.activity, "attempted");
  } finally { mixedServer.closeAllConnections(); await new Promise<void>((resolve) => mixedServer.close(() => resolve())); }
  const foundationGet = async (path = "") => {
    const response = await fetch(base.replace("/api/learning", "/api/foundations") + path, { headers: { cookie: "fixture=alice" } });
    assert.equal(response.status, 200);
    return response.json();
  };
  const curriculum = await foundationGet() as LearningCatalog;
  const curriculumDetails = await Promise.all(curriculum.lessons.map(lesson => foundationGet(`/lessons/${lesson.id}`)));
  // Public routes serve current content even when an old content version is requested.
  const superseded = await foundationGet("/lessons/split-the-capacity-budget?version=1") as LearningLessonDetail;
  assert.equal(superseded.lesson.contentVersion, 4);
  const missing = await get("/lessons/missing", "alice", 404);
  const oldId = await get("/lessons/split-the-capacity-budget-v1", "alice", 404);
  const missingIdResponse = await fetch(`${base}/lessons/`, { headers: { cookie: "fixture=alice" } });
  assert.equal(missingIdResponse.status, 404);
  const missingIdBody = await missingIdResponse.text();
  unavailable = true;
  const serverError = await get("/lessons/api-lab", "alice", 500);
  const catalogError = await get("", "alice", 500);
  unavailable = false;
  const routing = definition("route-around-a-slow-vm");
  publishedRows = [{ ...attemptRow(routing, routing.starter!, answers(routing, { "overall-health": "healthy" })), ownerId: "alice" }];
  const curriculumRecall = await foundationGet() as LearningCatalog;
  assert.equal(curriculumRecall.progress.find(p => p.lessonId === routing.id)!.activity, "attempted");
  assert.deepEqual(curriculumRecall.suggestions.reviewCandidates.map(s => s.lessonId), [routing.id]);
  // The report is larger than a pipe buffer; wait for the write to flush so the parent never reads a truncated string.
  const report = JSON.stringify({ realEngineSequence: ["not-started", "attempted", "requirements-met"], sessionReads,
    ownerScopedQueries: queries.length, authAnd404: true, earlierVersions: true, ownerIsolation: true,
    webProof: { foundations: curriculum, curriculumDetails, curriculumRecall, reading: await foundationGet("/lessons/what-is-a-request"),
      concept: await foundationGet("/lessons/client-and-server"), attemptedCatalog, lab: detail,
      audit: { unattemptedLab, failedLab, failedReport, blockedLab, blockedReport, staleCatalog, staleLab, superseded,
        missing, oldId, missingIdStatus: missingIdResponse.status, missingIdBody, serverError, catalogError } } });
  await new Promise<void>((resolve) => process.stdout.write(`${report}
`, () => resolve()));
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
