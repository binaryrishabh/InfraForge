import { Router, json } from "express";
import { z } from "zod";
import { NotFoundError, ValidationError } from "../utils/errors";
import { admissionSchema, CompilationRefusal } from "./envelope";
import { admit, hasInternalGrant, ownedRun, requestCancellation, internalDatabase } from "./store";
import { internalReport, reportHtml, replayStored } from "./report";
import { workspaceRouter } from "./workspace";
export const internalModel2Router = Router();
internalModel2Router.use(async (_req, res, next) => {
  if (!await hasInternalGrant(res.locals.userId)) throw new NotFoundError();
  res.set("Cache-Control", "no-store"); res.set("X-Content-Type-Options", "nosniff"); next();
});
internalModel2Router.use(json({ limit: "256kb" }));
internalModel2Router.use(workspaceRouter);
internalModel2Router.post("/runs", async (req, res) => {
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
  const rows = await internalDatabase.query('SELECT id,status,"inputHash",sequence,"throughUs",reason,"createdAt" FROM "InternalModel2Run" WHERE "ownerId"=$1 ORDER BY "createdAt" DESC,id DESC LIMIT 20', [res.locals.userId]);
  res.json({ success: true, runs: rows.rows, limit: 20 });
});
internalModel2Router.param("id", (req, _res, next, value) => { if (!z.uuid().safeParse(value).success) throw new ValidationError("A valid internal run ID is required"); next(); });
internalModel2Router.get("/runs/:id/report", async (req, res) => {
  const report = internalReport(await ownedRun(String(req.params.id), res.locals.userId));
  if (req.query.format === "html") {
    res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    res.type("html").send(reportHtml(report));
  } else res.json({ success: true, report });
});
internalModel2Router.get("/runs/:id/input", async (req, res) => { const row = await ownedRun(String(req.params.id), res.locals.userId); res.json({ success: true, input: row.input, inputHash: row.inputHash }); });
internalModel2Router.get("/runs/:id/replay", async (req, res) => {
  const row = await ownedRun(String(req.params.id), res.locals.userId);
  try { res.json({ success: true, replay: replayStored(row) }); }
  catch (error) { res.json({ success: true, replay: { kind: "Unavailable", reason: error instanceof Error ? error.message : "Historical replay unavailable" } }); }
});
internalModel2Router.post("/runs/:id/cancel", async (req, res) => {
  if (!z.object({}).strict().safeParse(req.body).success) throw new ValidationError("Cancellation requires an empty JSON object");
  const row = await requestCancellation(String(req.params.id), res.locals.userId); res.status(202).json({ success: true, id: row.id, status: row.status });
});
