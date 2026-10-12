import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { NotFoundError, ValidationError } from "../utils/errors";
import { buildRunReport, summarizeRun } from "./report";

export const reportRouter = Router();
const selection = { id: true, infrastructureId: true, infrastructure: { select: { name: true } },
  status: true, createdAt: true, updatedAt: true, resourceCount: true, workloadProfile: true,
  seed: true, runInputs: true, liveTopology: true, topologyRevision: true, stages: true,
  timeline: true, chaosEvents: true, simulationState: true } as const;
const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), before: z.uuid().optional() }).strict();

reportRouter.get("/history", async (req, res) => {
  const query = querySchema.safeParse(req.query);
  if (!query.success) throw new ValidationError("Use a limit from 1 to 100 and an optional deployment cursor.");
  const ownerId: string = res.locals.userId;
  const { limit, before } = query.data;
  if (before && !await prisma.deployment.findFirst({ where: { id: before, infrastructure: { ownerId } }, select: { id: true } })) {
    throw new NotFoundError("Run not found");
  }
  const rows = await prisma.deployment.findMany({ where: { infrastructure: { ownerId } }, select: selection,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}) });
  res.json({ success: true, runs: rows.slice(0, limit).map(summarizeRun),
    nextCursor: rows.length > limit ? rows[limit - 1]!.id : null });
});

reportRouter.get("/:deploymentId/report", async (req, res) => {
  const parsed = z.uuid().safeParse(req.params.deploymentId);
  if (!parsed.success) throw new ValidationError("A valid deployment ID is required.");
  const row = await prisma.deployment.findFirst({
    where: { id: parsed.data, infrastructure: { ownerId: res.locals.userId } }, select: selection });
  if (!row) throw new NotFoundError("Run not found");
  res.json({ success: true, report: buildRunReport(row) });
});
