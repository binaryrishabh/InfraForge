import { Router, json } from "express";
import { z } from "zod";
import { NotFoundError } from "../utils/errors";
import { createFirstStackService, FirstStackRefusal } from "./service";
import type { FirstStackRepository } from "./service";

export function createFirstStackRouter(repository: FirstStackRepository) {
  const router = Router(), service = createFirstStackService(repository);
  router.use((_req, res, next) => {
    if (res.locals.model2Scope !== "operator") throw new NotFoundError();
    next();
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
