import { model2RunRecord } from "../runRecords/adapters";
import { requireCapability } from "../capabilities/policy";
import { Router, json } from "express";
import { z } from "zod";
import { NotFoundError, ValidationError } from "../utils/errors";
import { admissionSchema, CompilationRefusal } from "./envelope";
import { admit, ownedRun, requestCancellation, internalDatabase } from "./store";
import { internalReport, reportHtml, replayStored } from "./report";
import { workspaceRouter } from "./workspace";
import { lessonRouter } from "./lessonRoutes";
import { grantScope, lessonRecord } from "./lessonStore";
import { replayLesson } from "./lessonExecution";
import { lessonSummary } from "./lessonSummary";
import { readLessonPolicy } from "./lessonPolicy";
export const internalModel2Router = Router();
internalModel2Router.use(async (_req, res, next) => {
  const scope = await grantScope(res.locals.userId);
  if (!scope) throw new NotFoundError();
  res.locals.model2Scope = scope;
  res.set("Cache-Control", "no-store"); res.set("X-Content-Type-Options", "nosniff"); next();
});
internalModel2Router.use(json({ limit: "256kb" }));
internalModel2Router.get("/capability", (_req, res) => { res.json({ scope: res.locals.model2Scope }); });
internalModel2Router.use(lessonRouter);
internalModel2Router.use(workspaceRouter);
internalModel2Router.post("/runs", async (req, res) => {
  if (res.locals.model2Scope !== "operator") throw new NotFoundError();
  const parsed = admissionSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "));
  try {
    const result = await admit(res.locals.userId, parsed.data);
    res.status(result.created ? 202 : 200).json({ success: true, id: result.run.id, status: result.run.status, inputHash: result.run.inputHash, created: result.created });
  } catch (error) {
    if (error instanceof CompilationRefusal) { res.status(422).json({ success: false, message: error.message, diagnostics: error.diagnostics }); return; }
    throw error;
  }
});
internalModel2Router.get("/runs", async (_req, res) => {
  const rows = await internalDatabase.query('SELECT r.id,r.status,r."inputHash",r.sequence,r."throughUs",r.reason,r."createdAt",l."runId" AS "lessonId",l.policy AS "lessonPolicy" FROM "InternalModel2Run" r LEFT JOIN "InternalModel2LessonRun" l ON l."runId"=r.id WHERE r."ownerId"=$1 AND ($2=\'operator\' OR l."runId" IS NOT NULL) ORDER BY r."createdAt" DESC,r.id DESC LIMIT 20', [res.locals.userId, res.locals.model2Scope]);
  const runs = rows.rows.map(({ lessonPolicy, lessonId, ...row }) => {
    if (lessonId === null) return row;
    try { const p = readLessonPolicy(lessonPolicy, row.inputHash); return { ...row, lesson: { phase: p.phase, profile: p.schema } }; }
    catch { return { ...row, lesson: { phase: "Unknown", profile: "Unknown" } }; }
  });
  res.json({ success: true, runs, limit: 20 });
});
internalModel2Router.param("id", (req, _res, next, value) => { if (!z.uuid().safeParse(value).success) throw new ValidationError("A valid internal run ID is required"); next(); });
internalModel2Router.use("/runs/:id", async (req, res, next) => {
  await ownedRun(String(req.params.id), res.locals.userId);
  if (res.locals.model2Scope !== "operator" && !await lessonRecord(String(req.params.id))) throw new NotFoundError();
  next();
});
internalModel2Router.get("/runs/:id/report", async (req, res) => {
  const row = await ownedRun(String(req.params.id), res.locals.userId), report = internalReport(row);
  const record = await lessonRecord(row.id);
  if (req.query.format === "html") {
    requireCapability(res.locals.userId, { capability: "artifact.export", artifactId: row.id, format: "html", scope: "run" });
    res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    res.type("html").send(reportHtml(report));
  } else res.json({ success: true, report: record ? { ...report, lesson: lessonSummary(row, record.policy, record.receipt) } : report });
});
internalModel2Router.get("/runs/:id/record", async (req, res) => {
  const row = await ownedRun(String(req.params.id), res.locals.userId);
  const lesson = await lessonRecord(row.id);
  const profile = lesson ? readLessonPolicy(lesson.policy, row.inputHash).schema : undefined;
  res.json({ success: true, record: model2RunRecord(row, profile) });
});
internalModel2Router.get("/runs/:id/input", async (req, res) => { const row = await ownedRun(String(req.params.id), res.locals.userId); res.json({ success: true, input: row.input, inputHash: row.inputHash }); });
internalModel2Router.get("/runs/:id/replay", async (req, res) => {
  const row = await ownedRun(String(req.params.id), res.locals.userId);
  try { res.json({ success: true, replay: await lessonRecord(row.id) ? await replayLesson(row) : replayStored(row) }); }
  catch (error) { res.json({ success: true, replay: { kind: "Unavailable", reason: error instanceof Error ? error.message : "Historical replay unavailable" } }); }
});
internalModel2Router.post("/runs/:id/cancel", async (req, res) => {
  if (!z.object({}).strict().safeParse(req.body).success) throw new ValidationError("Cancellation requires an empty JSON object");
  const row = await requestCancellation(String(req.params.id), res.locals.userId); res.status(202).json({ success: true, id: row.id, status: row.status });
});
