import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { NotFoundError, ValidationError } from "../utils/errors";
import { buildRunReport, summarizeRun } from "./report";
import { classifyComparison } from "../comparison/classify";
import { compareInputs } from "../comparison/inputs";
import { readRunInputs } from "../deployments/runInputs";

export const reportRouter = Router();
export const reportSelection = { id: true, infrastructureId: true, runName: true, runtimeActive: true,
  sourceRunId: true, rerunMode: true, autoStopAtSimulatedSeconds: true, sourceRun: { select: { runName: true } },
  challengeId: true, challengeVersion: true, challengeSpecHash: true, challengePrediction: true, predictionSubmittedAt: true,
  evaluationStopAtSimulatedSeconds: true,
  status: true, createdAt: true, updatedAt: true, resourceCount: true, workloadProfile: true,
  seed: true, runInputs: true, liveTopology: true, topologyRevision: true, stages: true,
  timeline: true, chaosEvents: true, simulationState: true, terminalSnapshot: true, _count: { select: { actions: true } } } as const;
const selection = reportSelection;
const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), before: z.uuid().optional(),
  kind: z.enum(["all", "challenge", "freeform"]).default("all") }).strict();

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
  const original = await prisma.deployment.findFirstOrThrow({ where: { id: id.data, ownerId }, select: { sourceRunId: true } });
  const relatedWhere = { OR: [{ id: original.sourceRunId ?? id.data }, { sourceRunId: id.data }, ...(original.sourceRunId ? [{ sourceRunId: original.sourceRunId }] : [])] };
  const related = await prisma.deployment.findMany({ where: { ...eligible, ...relatedWhere }, select: selection, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
  const sameDesign = source.infrastructureId ? await prisma.deployment.findMany({ where: { ...eligible, infrastructureId: source.infrastructureId, id: { notIn: [id.data, ...related.map((r) => r.id)] } }, select: selection, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 - related.length }) : [];
  const rest = await prisma.deployment.findMany({ where: { ...eligible, id: { notIn: [id.data, ...related.map((r) => r.id), ...sameDesign.map((r) => r.id)] } }, select: selection, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 - related.length - sameDesign.length });
  const rows = [...related, ...sameDesign, ...rest];
  res.json({ success: true, runs: rows.map(summarizeRun), limit: 100 });
});

reportRouter.get("/:deploymentId/family", async (req, res) => {
  const id = z.uuid().safeParse(req.params.deploymentId);
  if (!id.success) throw new ValidationError("A valid run ID is required.");
  const ownerId: string = res.locals.userId;
  const family = await prisma.$transaction(async (tx) => {
    const run = await tx.deployment.findFirst({ where: { id: id.data, ownerId }, select: selection });
    if (!run) throw new NotFoundError("Run not found");
    const source = run.sourceRunId ? await tx.deployment.findFirst({ where: { id: run.sourceRunId, ownerId }, select: selection }) : null;
    const rows = await tx.deployment.findMany({ where: { sourceRunId: run.id, ownerId }, select: selection, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 51 });
    const read = (v: unknown) => { try { return readRunInputs(v); } catch { return null; } };
    return { source: source ? summarizeRun(source) : null, reruns: rows.slice(0, 50).map((r) => ({ run: summarizeRun(r), starting: compareInputs(read(run.runInputs), read(r.runInputs)) })), limit: 50, truncated: rows.length > 50 };
  }, { isolationLevel: "RepeatableRead" });
  res.json({ success: true, family });
});

reportRouter.get("/history", async (req, res) => {
  const query = querySchema.safeParse(req.query);
  if (!query.success) throw new ValidationError("Use a limit from 1 to 100, an optional deployment cursor and kind all, challenge or freeform.");
  const ownerId: string = res.locals.userId;
  const { limit, before, kind } = query.data;
  const filter = kind === "challenge" ? { challengeId: { not: null } } : kind === "freeform" ? { challengeId: null } : {};
  if (before && !await prisma.deployment.findFirst({ where: { id: before, ownerId }, select: { id: true } })) {
    throw new NotFoundError("Run not found");
  }
  const rows = await prisma.deployment.findMany({ where: { ownerId, ...filter }, select: selection,
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
