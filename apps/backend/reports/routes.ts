import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { NotFoundError, ValidationError } from "../utils/errors";
import { buildRunReport, summarizeRun } from "./report";
import { classifyComparison } from "../comparison/classify";

export const reportRouter = Router();
export const reportSelection = { id: true, infrastructureId: true, runName: true, runtimeActive: true,
  status: true, createdAt: true, updatedAt: true, resourceCount: true, workloadProfile: true,
  seed: true, runInputs: true, liveTopology: true, topologyRevision: true, stages: true,
  timeline: true, chaosEvents: true, simulationState: true, terminalSnapshot: true, _count: { select: { actions: true } } } as const;
const selection = reportSelection;
const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), before: z.uuid().optional() }).strict();

reportRouter.get("/compare", async (req, res) => {
  const query = z.object({ a: z.uuid(), b: z.uuid() }).strict().safeParse(req.query);
  if (!query.success || query.data.a === query.data.b) throw new ValidationError("Select two distinct run IDs.");
  const comparison = await prisma.$transaction(async (tx) => {
    const rows = await tx.deployment.findMany({ where: { id: { in: [query.data.a, query.data.b] }, ownerId: res.locals.userId },
      select: { ...selection, actions: { orderBy: { sequence: "asc" }, take: 501 } } });
    if (rows.length !== 2) throw new NotFoundError("Run not found");
    return classifyComparison({ ...rows[0]!, actionCount: rows[0]!._count.actions }, { ...rows[1]!, actionCount: rows[1]!._count.actions });
  }, { isolationLevel: "RepeatableRead" });
  res.json({ success: true, comparison });
});

reportRouter.get("/:deploymentId/compare-options", async (req, res) => {
  const id = z.uuid().safeParse(req.params.deploymentId);
  if (!id.success) throw new ValidationError("A valid run ID is required.");
  const ownerId: string = res.locals.userId;
  const source = await prisma.deployment.findFirst({ where: { id: id.data, ownerId }, select: { infrastructureId: true } });
  if (!source) throw new NotFoundError("Run not found");
  const eligible = { ownerId, id: { not: id.data }, runtimeActive: false, status: { in: ["completed", "failed", "torn-down"] } };
  const rows = await prisma.deployment.findMany({ where: eligible, select: selection, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
  rows.sort((a, b) => Number(b.infrastructureId !== null && b.infrastructureId === source.infrastructureId) - Number(a.infrastructureId !== null && a.infrastructureId === source.infrastructureId));
  res.json({ success: true, runs: rows.map(summarizeRun), limit: 100 });
});

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
