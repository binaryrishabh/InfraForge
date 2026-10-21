import { Router, json } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import type { ErrorRequestHandler } from "express";
import { FirstStackCompileRefusal } from "@infraforge/simulation/internal-first-stack";
import { NotFoundError } from "../utils/errors";
import { closedSubmissionAdmission, createSubmissionService, type SubmissionAdmission } from "./admission";

// Mount behind requireSession and checkOrigin, before the ordinary JSON parser.
// Deliberately not mounted by index.ts: Model 2/public admission remains inactive.
export function createSubmissionRouter(pool: Pool, configuration: SubmissionAdmission = closedSubmissionAdmission) {
  const router = Router(), service = createSubmissionService(pool, configuration);
  router.use((_req, _res, next) => { if (!configuration.enabled) throw new NotFoundError(); next(); });
  router.use(json({ limit: "18mb", strict: true }));
  router.post("/", async (req, res) => {
    const result = await service.submit(res.locals.userId, req.body);
    res.setHeader("Cache-Control", "no-store");
    res.status(result.reused ? 200 : 201).json(result);
  });
  router.get("/:id", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    // Mutable verification projection stays uncached; future immutable artifact
    // endpoints can address resultHash with permanent headers after share policy.
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await service.read(res.locals.userId, id));
  });
  router.post("/:id/cancel", async (req, res) => {
    await service.cancel(res.locals.userId, z.uuid().parse(req.params.id));
    res.status(204).end();
  });
  const refusal: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof z.ZodError) { res.status(422).json({ message: "Invalid submission identity" }); return; }
    if (error instanceof FirstStackCompileRefusal) { res.status(422).json({ diagnostics: error.diagnostics }); return; }
    next(error);
  };
  router.use(refusal);
  return router;
}
