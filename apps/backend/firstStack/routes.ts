import { Router, json } from "express";
import { z } from "zod";
import { NotFoundError } from "../utils/errors";
import { createFirstStackService, FirstStackRefusal } from "./service";
import type { FirstStackRepository } from "./service";
import { resolveWorkload, WorkloadRefusal } from "./workload";
import { readImportContext } from "./importStream";
import { requireCapability } from "../capabilities/policy";
import { firstStackLimits as limits } from "@infraforge/contracts/first-stack";

export function createFirstStackRouter(repository: FirstStackRepository) {
  const router = Router(), service = createFirstStackService(repository);
  router.use((_req, res, next) => {
    if (res.locals.model2Scope !== "operator") throw new NotFoundError();
    next();
  });
  router.post("/workload/resolve", async (req, res) => {
    if (!req.is("application/x-infraforge-first-stack-import")) { res.status(415).json({ message: "Use the bounded first-stack import stream" }); return; }
    const abort = new AbortController();
    req.once("aborted", () => abort.abort());
    res.once("close", () => { if (!res.writableEnded) abort.abort(); });
    try {
      requireCapability(res.locals.userId, { capability: "load.recorded.accept", bytes: limits.scheduleBytes + limits.parameterBytes, rows: limits.rows, durationSeconds: limits.durationUs / 1_000_000, scale: 1 });
      const { context, schedule } = await readImportContext(req);
      const review = await service.review(res.locals.userId, context.infrastructureId, context.expectedDesignUpdatedAt);
      if (!review.ok) throw new FirstStackRefusal(review.diagnostics);
      const workload = await resolveWorkload(schedule, { owner: res.locals.userId, sidecar: review.sidecar,
        parameters: context.parameters, transform: context.transform, signal: abort.signal });
      res.json({ success: true, executable: false, designRevision: review.designRevision, workload });
    } catch (e) {
      if (e instanceof WorkloadRefusal) { res.status(422).json({ diagnostics: [{ code: e.code, path: e.path, message: e.message }] }); return; }
      if (e instanceof FirstStackRefusal) { res.status(422).json({ diagnostics: e.diagnostics }); return; }
      throw e;
    }
  });
  router.use(json({ limit: "16mb" }));
  const request = z.object({ infrastructureId: z.uuid(), expectedDesignUpdatedAt: z.iso.datetime(), sidecar: z.json().optional() }).strict();
  for (const action of ["review", "save", "copy"] as const) router.post(`/${action}`, async (req, res) => {
    const input = request.safeParse(req.body);
    if (!input.success) { res.status(422).json({ diagnostics: input.error.issues.map(e => ({ code: "FIRST_STACK_FIELD", path: e.path.join("."), message: e.message })) }); return; }
    const { infrastructureId, expectedDesignUpdatedAt, sidecar } = input.data;
    try {
      if (action === "review") {
        const review = await service.review(res.locals.userId, infrastructureId, expectedDesignUpdatedAt, sidecar);
        res.status(review.ok ? 200 : 422).json(review);
      } else {
        const saved = await service.save(res.locals.userId, infrastructureId, expectedDesignUpdatedAt, sidecar, action === "copy");
        res.status(action === "copy" ? 201 : 200).json({ success: true, infrastructure: saved, executable: false });
      }
    } catch (e) { if (e instanceof FirstStackRefusal) { res.status(422).json({ diagnostics: e.diagnostics }); return; } throw e; }
  });
  return router;
}
