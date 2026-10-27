import { admitDeployment } from "../deployments/admission";
import { requireCapability } from "../capabilities/policy";
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
import { categoryOf, challengeSeed, findChallenge, latestChallenge, listLatestChallenges } from "./registry";
import { readPrediction } from "./prediction";
import { preflight } from "./preflight";
import { experimentReadiness, recordedExperiment } from "./experiment";
import { learningAttempt } from "./history";
import { HYPOTHESIS_MAX } from "@infraforge/contracts/challenges";
import { improvementRouter } from "./improvementRoutes";
import { improvementSource } from "./improvements";
import { reviewDesignChanges } from "./designChanges";

export const challengeRouter = Router();
challengeRouter.use(improvementRouter);
const STARTER_LAYOUT_VERSION = 3;
const ATTEMPT_WINDOW = 20;
const challengeId = z.string().regex(/^[a-z0-9-]{1,64}$/);

// The latest version, or an exact earlier one for reading a historical brief.
function entryFor(raw: unknown, version?: unknown) {
  const id = challengeId.safeParse(raw);
  const wanted = version === undefined ? null : z.coerce.number().int().min(1).max(10_000).safeParse(version);
  if (wanted && !wanted.success) throw new NotFoundError("Challenge version not found");
  const entry = !id.success ? null : wanted ? findChallenge(id.data, wanted.data) : latestChallenge(id.data);
  if (!entry) throw new NotFoundError(wanted ? "Challenge version not found" : "Challenge not found");
  return entry;
}

function attemptSummary(row: StoredRun): ChallengeAttemptSummary {
  const run = summarizeRun(row);
  return { runId: run.id, version: row.challengeVersion ?? 0, createdAt: run.createdAt, status: run.challenge?.status ?? "unavailable",
    metCount: run.challenge?.metCount ?? 0, total: run.challenge?.total ?? 0 };
}

async function attemptsOf(ownerId: string, id: string, database: Pick<typeof prisma, "deployment"> = prisma, version?: number) {
  const rows = await database.deployment.findMany({ where: { ownerId, challengeId: id, ...(version ? { challengeVersion: version } : {}) }, select: reportSelection,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: ATTEMPT_WINDOW });
  return rows.map((row) => ({ challengeId: row.challengeId!, summary: attemptSummary(row) }));
}

// Newest first. A workspace belongs to exactly one version of its challenge.
function workspacesOf(ownerId: string, id?: string) {
  return prisma.infrastructure.findMany({ where: { ownerId, challengeId: id ?? { not: null } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { id: true, challengeId: true, challengeVersion: true } });
}

challengeRouter.get("/", async (_req, res) => {
  const ownerId: string = res.locals.userId;
  const entries = listLatestChallenges();
  // One bounded indexed query per challenge, in the counts' snapshot. Activity in
  // another challenge can never evict this challenge's actual latest attempt.
  const { attempts, counts } = await prisma.$transaction(async (tx) => {
    const [attempts, counts] = await Promise.all([Promise.all(entries.map(({ definition }) => attemptsOf(ownerId, definition.id, tx))),
      tx.deployment.groupBy({ by: ["challengeId"], where: { ownerId, challengeId: { in: entries.map((e) => e.definition.id) } }, _count: { _all: true } })]);
    return { attempts, counts };
  }, { isolationLevel: "RepeatableRead" });
  const workspaces = await workspacesOf(ownerId);
  const challenges: ChallengeSummary[] = entries.map(({ definition }, i) => {
    const mine = attempts[i]!.map((a) => a.summary);
    return { id: definition.id, version: definition.version, category: categoryOf(definition), title: definition.title,
      recentAttemptLimit: ATTEMPT_WINDOW,
      difficulty: definition.difficulty, summary: definition.summary, concepts: definition.concepts, evaluationSeconds: definition.evaluationSeconds,
      requirementCount: definition.criteria.length, attempts: counts.find((c) => c.challengeId === definition.id)?._count._all ?? 0,
      met: mine.some((a) => a.status === "met"), latest: mine[0] ?? null,
      workspaceDesignId: workspaces.find((w) => w.challengeId === definition.id && w.challengeVersion === definition.version)?.id ?? null };
  });
  res.json({ success: true, challenges });
});

challengeRouter.get("/attempt-history", async (req, res) => {
  const query = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), before: z.uuid().optional() }).strict().safeParse(req.query);
  if (!query.success) throw new ValidationError("Use a history limit from 1 to 50 and an optional attempt cursor.");
  const ownerId: string = res.locals.userId, { limit, before } = query.data;
  const history = await prisma.$transaction(async (tx) => {
    if (before && !await tx.deployment.findFirst({ where: { id: before, ownerId, challengeId: { not: null } }, select: { id: true } })) throw new NotFoundError("Attempt not found");
    const rows = await tx.deployment.findMany({ where: { ownerId, challengeId: { not: null } }, select: reportSelection,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, ...(before ? { cursor: { id: before }, skip: 1 } : {}) });
    return { attempts: rows.slice(0, limit).map(learningAttempt), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
  }, { isolationLevel: "RepeatableRead" });
  res.json({ success: true, history });
});

challengeRouter.get("/:id", async (req, res) => {
  const { definition, hash } = entryFor(req.params.id, req.query.version);
  const latest = latestChallenge(definition.id)!.definition.version;
  const ownerId: string = res.locals.userId;
  const [attempts, workspaces] = await Promise.all([attemptsOf(ownerId, definition.id, prisma, definition.version), workspacesOf(ownerId, definition.id)]);
  const summaries = attempts.map((a) => a.summary);
  // The deeper explanation opens only after the learner has a judged attempt at this version.
  const judged = summaries.some((a) => a.version === definition.version && (a.status === "met" || a.status === "not-met"));
  const earlier = workspaces.find((w) => (w.challengeVersion ?? 0) < definition.version);
  const brief: ChallengeBrief = { ...definition, specHash: hash, category: categoryOf(definition), latestVersion: latest,
    debrief: judged ? definition.debrief : null, attempts: summaries.slice(0, 20),
    workspaceDesignId: workspaces.find((w) => w.challengeVersion === definition.version)?.id ?? null,
    earlierWorkspace: earlier ? { designId: earlier.id, version: earlier.challengeVersion ?? 1 } : null };
  res.json({ success: true, challenge: brief });
});

/* Opens the learner's workspace for the latest version. A workspace from an earlier
version is never reused silently: the learner starts from the new starter, or
explicitly copies an earlier workspace's design into a new one. */
const workspaceBody = z.object({ fresh: z.boolean().default(false), copyFrom: z.uuid().optional() }).strict();
challengeRouter.post("/:id/workspace", async (req, res) => {
  const { definition } = entryFor(req.params.id);
  const body = workspaceBody.safeParse(req.body ?? {});
  if (!body.success) throw new ValidationError("Only a fresh-start flag or an earlier workspace to copy is accepted.");
  const ownerId: string = res.locals.userId;
  if (!body.data.fresh && !body.data.copyFrom) {
    const existing = (await workspacesOf(ownerId, definition.id)).find((w) => w.challengeVersion === definition.version);
    if (existing) return res.json({ success: true, designId: existing.id, created: false });
  }
  let layout: object = { resources: definition.starter?.resources ?? [], connectionLines: definition.starter?.connectionLines ?? [], layoutVersion: STARTER_LAYOUT_VERSION };
  if (body.data.copyFrom) {
    const source = await prisma.infrastructure.findFirst({ where: { id: body.data.copyFrom, ownerId, challengeId: definition.id }, select: { layout: true } });
    const copied = source ? LayoutSchema.safeParse(source.layout) : null;
    if (!copied) throw new NotFoundError("That earlier workspace was not found.");
    if (!copied.success) throw new ValidationError("That earlier workspace's design cannot be read, so it cannot be copied.");
    layout = copied.data;
  }
  requireCapability(ownerId, { capability: "design.persist", operation: "create", countDelta: 1 });
  const design = await prisma.infrastructure.create({ data: { name: definition.title, userId: ownerId, ownerId,
    challengeId: definition.id, challengeVersion: definition.version, layout: storedJson(layout) }, select: { id: true } });
  res.status(201).json({ success: true, designId: design.id, created: true });
});

const previewBody = z.object({ layout: LayoutSchema.extend({
  resources: LayoutSchema.shape.resources.unwrap().max(500),
  connectionLines: LayoutSchema.shape.connectionLines.unwrap().max(1000),
}) }).strict();
challengeRouter.post("/:id/preflight", async (req, res) => {
  const { definition } = entryFor(req.params.id, req.query.version);
  const parsed = previewBody.safeParse(req.body);
  if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > 65536) throw new ValidationError("A bounded canvas layout is required.");
  res.json({ success: true, preflight: preflight(definition, parsed.data.layout) });
});

// Strict: the workload, seed, evaluation time, experiment and rules come only from the source-controlled definition.
const attemptBody = z.object({ infrastructureId: z.uuid(), prediction: z.unknown(), improvement: z.object({
  sourceRunId: z.uuid(), hypothesis: z.string().trim().min(1).max(HYPOTHESIS_MAX), intent: z.enum(["improvement", "repeat"]),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/), acknowledgeMultiple: z.boolean(),
}).strict().optional() }).strict();
challengeRouter.post("/:id/attempts", async (req, res) => {
  const body = attemptBody.safeParse(req.body);
  if (!body.success) throw new ValidationError("A challenge design and a complete prediction are required. Workload, rules and the experiment cannot be supplied.");
  const { definition, hash } = entryFor(req.params.id, body.data.improvement ? req.query.version : undefined);
  const ownerId: string = res.locals.userId;
  const run = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Infrastructure" WHERE id = ${body.data.infrastructureId} FOR UPDATE`;
    const design = await tx.infrastructure.findFirst({ where: { id: body.data.infrastructureId, ownerId } });
    if (!design) throw new NotFoundError("Design not found");
    if (design.challengeId !== definition.id) throw new ConflictError("This design is not a workspace for this challenge.");
    if (design.challengeVersion !== definition.version) {
      throw new ConflictError(`This workspace belongs to version ${design.challengeVersion} of the challenge. Start version ${definition.version} before attempting it.`);
    }
    const active = await tx.deployment.count({ where: { ownerId, challengeId: definition.id, OR: [{ status: { in: ["pending", "running", "live"] } }, { runtimeActive: true }] } });
    if (active) throw new ConflictError("An attempt at this challenge is still running. Stop it or let it reach the evaluation second first.");
    const runInputs = captureRunInputs(design.layout, definition.workload, challengeSeed(definition), definition.engine);
    const improvement = body.data.improvement;
    if (improvement) {
      await tx.$queryRaw`SELECT id FROM "Deployment" WHERE id = ${improvement.sourceRunId} AND "ownerId" = ${ownerId} FOR SHARE`;
      const source = await tx.deployment.findFirst({ where: { id: improvement.sourceRunId, ownerId } });
      if (!source) throw new NotFoundError("Source attempt not found");
      const original = improvementSource(source, definition.id);
      if (original.definition.version !== definition.version) throw new ConflictError("Use the source's exact challenge version.");
      const review = reviewDesignChanges(original.input, runInputs);
      if (review.classification === "unavailable" || review.inputHash !== improvement.inputHash) throw new ConflictError("The design or conditions changed after review. Review the current design again.");
      if ((review.count === 0) !== (improvement.intent === "repeat")) throw new ConflictError("No simulation-relevant change requires an explicit repeat; a changed design is an improvement experiment.");
      if (review.classification === "several-changes" && !improvement.acknowledgeMultiple) throw new ConflictError("Acknowledge several changes before continuing.");
    }
    const readiness = validateDeploymentReadiness(runInputs.resources, runInputs.connectionLines);
    if (!readiness.valid) throw new ValidationError(`Fix the design before starting: ${readiness.errors.join("; ")}`);
    if (definition.experiment) {
      const ready = experimentReadiness(definition.experiment, runInputs, definition.engine);
      if (!ready.ready) throw new ValidationError(`The experiment cannot run: ${ready.detail}`);
    }
    const prediction = readPrediction(body.data.prediction, definition, runInputs.resources.map((r) => r.type));
    const experiment = recordedExperiment(definition);
    requireCapability(ownerId, { capability: "run.start", purpose: "learner", engine: definition.engine ?? "1", profile: runInputs.simulationModelVersion, durationSeconds: definition.evaluationSeconds });
    const created = await admitDeployment(tx, { id: randomUUID(), infrastructureId: design.id, ownerId, runName: design.name,
      resourceCount: runInputs.resources.length, workloadProfile: runInputs.workloadProfile, seed: runInputs.seed, runInputs,
      liveTopology: { resources: runInputs.resources, connectionLines: runInputs.connectionLines },
      challengeId: definition.id, challengeVersion: definition.version, challengeSpecHash: hash,
      ...(improvement ? { improvementSourceId: improvement.sourceRunId, learningHypothesis: improvement.hypothesis, learningIntent: improvement.intent } : {}),
      challengePrediction: storedJson(prediction), predictionSubmittedAt: new Date(),
      evaluationStopAtSimulatedSeconds: definition.evaluationSeconds, ...(experiment ? { challengeExperiment: storedJson(experiment) } : {}) });
    return created;
  });
  res.status(201).json({ success: true, createdDeployment: run });
});
