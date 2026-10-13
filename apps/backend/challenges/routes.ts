import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import type { ChallengeAttemptSummary, ChallengeBrief, ChallengeSummary } from "@infraforge/contracts/challenges";
import { prisma } from "../lib/prisma";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors";
import { storedJson } from "../utils/json";
import { captureRunInputs } from "../deployments/runInputs";
import { reportSelection } from "../reports/routes";
import { summarizeRun, type StoredRun } from "../reports/report";
import { LayoutSchema } from "../zod_schemas/layout.schema";
import { challengeSeed, findChallenge, listChallenges } from "./registry";
import { readPrediction } from "./prediction";
import { preflight } from "./preflight";

export const challengeRouter = Router();
const STARTER_LAYOUT_VERSION = 3;
const ATTEMPT_WINDOW = 300;

function entryFor(raw: unknown) {
  const id = z.string().regex(/^[a-z0-9-]{1,64}$/).safeParse(raw);
  const entry = id.success ? findChallenge(id.data) : null;
  if (!entry) throw new NotFoundError("Challenge not found");
  return entry;
}

function attemptSummary(row: StoredRun): ChallengeAttemptSummary {
  const run = summarizeRun(row);
  return { runId: run.id, createdAt: run.createdAt, status: run.challenge?.status ?? "unavailable",
    metCount: run.challenge?.metCount ?? 0, total: run.challenge?.total ?? 0 };
}

async function attemptsOf(ownerId: string, challengeId?: string) {
  const rows = await prisma.deployment.findMany({ where: { ownerId, challengeId: challengeId ?? { not: null } }, select: reportSelection,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: ATTEMPT_WINDOW });
  return rows.map((row) => ({ challengeId: row.challengeId!, summary: attemptSummary(row) }));
}

async function workspaceOf(ownerId: string, challengeId: string) {
  return prisma.infrastructure.findFirst({ where: { ownerId, challengeId }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { id: true } });
}

challengeRouter.get("/", async (_req, res) => {
  const ownerId: string = res.locals.userId;
  const [attempts, counts, workspaces] = await Promise.all([
    attemptsOf(ownerId),
    prisma.deployment.groupBy({ by: ["challengeId"], where: { ownerId, challengeId: { not: null } }, _count: { _all: true } }),
    prisma.infrastructure.findMany({ where: { ownerId, challengeId: { not: null } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { id: true, challengeId: true } }),
  ]);
  const challenges: ChallengeSummary[] = listChallenges().map(({ definition }) => {
    const mine = attempts.filter((a) => a.challengeId === definition.id).map((a) => a.summary);
    return { id: definition.id, version: definition.version, title: definition.title, difficulty: definition.difficulty,
      summary: definition.summary, concepts: definition.concepts, evaluationSeconds: definition.evaluationSeconds,
      requirementCount: definition.criteria.length, attempts: counts.find((c) => c.challengeId === definition.id)?._count._all ?? 0,
      met: mine.some((a) => a.status === "met"), latest: mine[0] ?? null,
      workspaceDesignId: workspaces.find((w) => w.challengeId === definition.id)?.id ?? null };
  });
  res.json({ success: true, challenges });
});

challengeRouter.get("/:id", async (req, res) => {
  const { definition, hash } = entryFor(req.params.id);
  const ownerId: string = res.locals.userId;
  const [attempts, workspace] = await Promise.all([attemptsOf(ownerId, definition.id), workspaceOf(ownerId, definition.id)]);
  const summaries = attempts.map((a) => a.summary);
  // The deeper explanation opens only after the learner has a judged attempt of their own.
  const judged = summaries.some((a) => a.status === "met" || a.status === "not-met");
  const brief: ChallengeBrief = { ...definition, specHash: hash, debrief: judged ? definition.debrief : null,
    attempts: summaries.slice(0, 20), workspaceDesignId: workspace?.id ?? null };
  res.json({ success: true, challenge: brief });
});

challengeRouter.post("/:id/workspace", async (req, res) => {
  const { definition } = entryFor(req.params.id);
  const body = z.object({ fresh: z.boolean().default(false) }).strict().safeParse(req.body ?? {});
  if (!body.success) throw new ValidationError("Only a fresh-start flag is accepted.");
  const ownerId: string = res.locals.userId;
  const existing = body.data.fresh ? null : await workspaceOf(ownerId, definition.id);
  if (existing) return res.json({ success: true, designId: existing.id, created: false });
  const layout = { resources: definition.starter?.resources ?? [], connectionLines: definition.starter?.connectionLines ?? [], layoutVersion: STARTER_LAYOUT_VERSION };
  const design = await prisma.infrastructure.create({ data: { name: definition.title, userId: ownerId, ownerId,
    challengeId: definition.id, layout: storedJson(layout) }, select: { id: true } });
  res.status(201).json({ success: true, designId: design.id, created: true });
});

const previewBody = z.object({ layout: LayoutSchema.extend({
  resources: LayoutSchema.shape.resources.unwrap().max(500),
  connectionLines: LayoutSchema.shape.connectionLines.unwrap().max(1000),
}) }).strict();
challengeRouter.post("/:id/preflight", async (req, res) => {
  const { definition } = entryFor(req.params.id);
  const parsed = previewBody.safeParse(req.body);
  if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > 65536) throw new ValidationError("A bounded canvas layout is required.");
  res.json({ success: true, preflight: preflight(definition, parsed.data.layout) });
});

// Strict: the workload, seed, evaluation time and rules come only from the source-controlled definition.
const attemptBody = z.object({ infrastructureId: z.uuid(), prediction: z.unknown() }).strict();
challengeRouter.post("/:id/attempts", async (req, res) => {
  const { definition, hash } = entryFor(req.params.id);
  const body = attemptBody.safeParse(req.body);
  if (!body.success) throw new ValidationError("A challenge design and a complete prediction are required. Workload and rules cannot be supplied.");
  const ownerId: string = res.locals.userId;
  const run = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Infrastructure" WHERE id = ${body.data.infrastructureId} FOR UPDATE`;
    const design = await tx.infrastructure.findFirst({ where: { id: body.data.infrastructureId, ownerId } });
    if (!design) throw new NotFoundError("Design not found");
    if (design.challengeId !== definition.id) throw new ConflictError("This design is not a workspace for this challenge.");
    const active = await tx.deployment.count({ where: { ownerId, challengeId: definition.id, OR: [{ status: { in: ["pending", "running", "live"] } }, { runtimeActive: true }] } });
    if (active) throw new ConflictError("An attempt at this challenge is still running. Stop it or let it reach the evaluation second first.");
    const runInputs = captureRunInputs(design.layout, definition.workload, challengeSeed(definition));
    const readiness = validateDeploymentReadiness(runInputs.resources, runInputs.connectionLines);
    if (!readiness.valid) throw new ValidationError(`Fix the design before starting: ${readiness.errors.join("; ")}`);
    const prediction = readPrediction(body.data.prediction, definition, runInputs.resources.map((r) => r.type));
    const created = await tx.deployment.create({ data: { id: randomUUID(), infrastructureId: design.id, ownerId, runName: design.name,
      resourceCount: runInputs.resources.length, workloadProfile: runInputs.workloadProfile, seed: runInputs.seed, runInputs,
      liveTopology: { resources: runInputs.resources, connectionLines: runInputs.connectionLines },
      challengeId: definition.id, challengeVersion: definition.version, challengeSpecHash: hash,
      challengePrediction: storedJson(prediction), predictionSubmittedAt: new Date(),
      evaluationStopAtSimulatedSeconds: definition.evaluationSeconds } });
    await tx.outbox.create({ data: { eventType: "deployment-created", payload: { deploymentId: created.id } } });
    return created;
  });
  res.status(201).json({ success: true, createdDeployment: run });
});
