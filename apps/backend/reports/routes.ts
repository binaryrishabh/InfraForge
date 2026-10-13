import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { NotFoundError, ValidationError } from "../utils/errors";
import { buildRunReport, summarizeRun } from "./report";

export const reportRouter = Router();
const selection = { id: true, infrastructureId: true, runName: true,
  status: true, createdAt: true, updatedAt: true, resourceCount: true, workloadProfile: true,
  seed: true, runInputs: true, liveTopology: true, topologyRevision: true, stages: true,
  timeline: true, chaosEvents: true, simulationState: true, terminalSnapshot: true, _count: { select: { actions: true } } } as const;
const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), before: z.uuid().optional() }).strict();

reportRouter.get("/history", async (req, res) => {
  const query = querySchema.safeParse(req.query);
  if (!query.success) throw new ValidationError("Use a limit from 1 to 100 and an optional deployment cursor.");
  const ownerId: string = res.locals.userId;
  const { limit, before } = query.data;
  if (before && !await prisma.deployment.findFirst({ where: { id: before, ownerId }, select: { id: true } })) {
    throw new NotFoundError("Run not found");
  }
  const rows = await prisma.deployment.findMany({ where: { ownerId }, select: selection,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}) });
  const counts = await prisma.runAction.groupBy({ by: ["deploymentId"], where: { deploymentId: { in: rows.map((r) => r.id) }, kind: "chaos" }, _count: { _all: true } });
  const chaos = new Map(counts.map((c) => [c.deploymentId, c._count._all]));
  res.json({ success: true, runs: rows.slice(0, limit).map((row) => summarizeRun({ ...row,
    actionCount: row._count.actions, durableChaosCount: chaos.get(row.id) ?? 0 })),
    nextCursor: rows.length > limit ? rows[limit - 1]!.id : null });
});

reportRouter.get("/:deploymentId/report", async (req, res) => {
  const parsed = z.uuid().safeParse(req.params.deploymentId);
  if (!parsed.success) throw new ValidationError("A valid deployment ID is required.");
  const report = await prisma.$transaction(async (tx) => {
    const row = await tx.deployment.findFirst({ where: { id: parsed.data, ownerId: res.locals.userId },
      select: { ...selection, actions: { orderBy: { sequence: "desc" }, take: 501 } } });
    if (!row) throw new NotFoundError("Run not found");
    const durableChaosCount = await tx.runAction.count({ where: { deploymentId: row.id, kind: "chaos" } });
    return buildRunReport({ ...row, actionCount: row._count.actions, durableChaosCount });
  }, { isolationLevel: "RepeatableRead" });
  res.json({ success: true, report });
});
