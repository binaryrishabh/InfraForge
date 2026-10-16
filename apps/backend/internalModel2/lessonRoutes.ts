import { Router } from "express";
import { z } from "zod";
import { LESSON_VERSION } from "@infraforge/contracts/internal-lessons";
import { admissionSchema } from "./envelope";
import { lessonChoice, lessonSubmission, makeLessonPolicy, readLessonPolicy } from "./lessonPolicy";
import { lessonImage } from "./lessonLimits";
import { createLessonDesign, lessonDesigns, reviewLesson } from "./lessonAuthoring";
import { admit, internalDatabase } from "./store";
import { ConflictError, ValidationError } from "../utils/errors";
export const lessonRouter = Router();
lessonRouter.get("/lesson", async (_req, res) => { res.json({ success: true, workspace: { designs: await lessonDesigns(res.locals.userId), configured: lessonImage() !== null, profile: LESSON_VERSION, operator: res.locals.model2Scope === "operator" } }); });
lessonRouter.post("/lesson/design", async (req, res) => {
  if (!z.object({}).strict().safeParse(req.body).success) throw new ValidationError("Creating the lesson design requires an empty object");
  res.status(201).json({ success: true, id: await createLessonDesign(res.locals.userId) });
});
lessonRouter.post("/lesson/review", async (req, res) => {
  const parsed = lessonChoice.safeParse(req.body);
  if (!parsed.success) throw new ValidationError("A supported lesson phase, owned design revision and retry key are required");
  res.json({ success: true, lesson: await reviewLesson(res.locals.userId, parsed.data) });
});
lessonRouter.post("/lesson/runs", async (req, res) => {
  const parsed = lessonSubmission.safeParse(req.body);
  if (!parsed.success) throw new ValidationError("Submit the exact reviewed lesson choice and review identity");
  const { reviewHash, ...choice } = parsed.data, owner = res.locals.userId;
  const existing = (await internalDatabase.query(`SELECT r.*,l.policy FROM "InternalModel2Run" r JOIN "InternalModel2LessonRun" l ON l."runId"=r.id WHERE r."ownerId"=$1 AND r."idempotencyKey"=$2`, [owner, choice.idempotencyKey])).rows[0];
  // Recover an uncertain admission even if an operator has since changed the image.
  if (existing) {
    const policy = readLessonPolicy(existing.policy, existing.inputHash);
    if (policy.reviewHash !== reviewHash || policy.phase !== choice.phase || existing.input.infrastructureId !== choice.infrastructureId || existing.input.designUpdatedAt !== choice.expectedDesignUpdatedAt) throw new ConflictError("Retry key already names another reviewed lesson");
    res.json({ success: true, id: existing.id, status: existing.status, inputHash: existing.inputHash, created: false }); return;
  }
  const review = await reviewLesson(owner, choice);
  if (review.reviewHash !== reviewHash) throw new ConflictError("Review is stale. Review the current design, teaching profile and isolation image again.");
  const result = await admit(owner, admissionSchema.parse(review.review.request), (input) => makeLessonPolicy(input.fingerprint, choice.phase, review.image, reviewHash));
  res.status(result.created ? 202 : 200).json({ success: true, id: result.run.id, status: result.run.status, inputHash: result.run.inputHash, created: result.created });
});
