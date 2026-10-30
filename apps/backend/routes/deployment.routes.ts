import { admitDeployment, admitReplay } from "../deployments/admission";
import { authorizeCapability, executionAllowance, requireCapability } from "../capabilities/policy";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { ConflictError, ValidationError, NotFoundError } from "../utils/errors";
import { DeploymentCreateBodySchema, DeploymentIdSchema } from "../zod_schemas/deployment.schema";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { readRecordedExperiment } from "../challenges/experiment";
import { verifiedScenario } from "../challenges/scenario";
import { findChallenge } from "../challenges/registry";
import { runtimeHorizon } from "../deployments/operationalLimits";
import { checkSubmission } from "../browserRuns/submission";
import { storedJson } from "../utils/json";
import { DeploymentStatus, RUN_CONTRACT } from "@infraforge/contracts/deployment";
import { reportRouter } from "../reports/routes";
import { actionRouter } from "../actions/routes";
import { rerunRouter } from "../reruns/routes";

export const deploymentRouter = Router();
deploymentRouter.use(reportRouter);
deploymentRouter.use(actionRouter);
deploymentRouter.use(rerunRouter);

deploymentRouter.post("/", async (req, res) => {
  const body = DeploymentCreateBodySchema.safeParse(req.body);
  if (!body.success) throw new ValidationError("A saved infrastructure ID and valid workload are required.");
  const { infrastructureId, workloadProfile } = body.data;
  const createdDeployment = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Infrastructure" WHERE id = ${infrastructureId} FOR UPDATE`;
    const infrastructure = await tx.infrastructure.findUnique({ where: { id: infrastructureId, ownerId: res.locals.userId } });
    if (!infrastructure) throw new NotFoundError("Infrastructure not found");
    const runInputs = captureRunInputs(infrastructure.layout, workloadProfile);
    requireCapability(infrastructure.ownerId!, { capability: "run.start", purpose: "engineer", engine: "2", profile: runInputs.simulationModelVersion, durationSeconds: null });
    const run = await admitDeployment(tx, { id: randomUUID(), infrastructureId,
      ownerId: infrastructure.ownerId, runName: infrastructure.name,
      resourceCount: runInputs.resources.length, workloadProfile: runInputs.workloadProfile,
      seed: runInputs.seed, runInputs,
      liveTopology: { resources: runInputs.resources, connectionLines: runInputs.connectionLines } });
    return run;
  });
  res.status(201).json({ success: true, message: "Deployment created", createdDeployment });
});

deploymentRouter.get("/capabilities", (_req, res) => {
  const subject = { ownerId: res.locals.userId };
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, runContract: RUN_CONTRACT, availability: {
    run: authorizeCapability(subject, { capability: "run.start", purpose: "engineer", engine: "1", profile: null, durationSeconds: null }),
    save: authorizeCapability(subject, { capability: "design.persist", operation: "create", countDelta: 1 }),
    export: authorizeCapability(subject, { capability: "artifact.export", artifactId: "availability", format: "html", scope: "run" }),
  } });
});

deploymentRouter.get("/live", async (_req, res) => {
  // Includes runs still running in the browser.
  const rows = await prisma.deployment.findMany({ where: { status: { in: ["live", "browser"] }, ownerId: res.locals.userId }, orderBy: { updatedAt: "desc" } });
  res.json({ success: true, deployments: rows.map((run) => ({ id: run.id, infrastructureId: run.infrastructureId,
    infrastructureName: run.runName ?? "Unnamed legacy run", resourceCount: run.resourceCount, challengeId: run.challengeId,
    status: run.status, createdAt: run.createdAt, updatedAt: run.updatedAt })) });
});

deploymentRouter.get("/:deploymentId", async (req, res) => {
  const parsed = DeploymentIdSchema.safeParse(req.params);
  if (!parsed.success) throw new ValidationError("A valid deployment ID is required.");
  const deployment = await prisma.deployment.findUnique({ where: { id: parsed.data.deploymentId, ownerId: res.locals.userId } });
  if (!deployment) throw new NotFoundError("Run not found");
  res.json({ success: true, deployment });
});

// Everything the browser needs to run a Model 2 run exactly as the server will replay it.
deploymentRouter.get("/:deploymentId/browser-run", async (req, res) => {
  const parsed = DeploymentIdSchema.safeParse(req.params);
  if (!parsed.success) throw new ValidationError("A valid deployment ID is required.");
  const run = await prisma.deployment.findFirst({ where: { id: parsed.data.deploymentId, ownerId: res.locals.userId } });
  if (!run) throw new NotFoundError("Run not found");
  if (run.status !== DeploymentStatus.BROWSER) throw new ConflictError("This run is not waiting for the browser.");
  const input = readRunInputs(run.runInputs);
  const horizonSeconds = runtimeHorizon(executionAllowance(run.autoStopAtSimulatedSeconds ?? run.evaluationStopAtSimulatedSeconds).durationSeconds);
  const plan = run.challengeExperiment == null ? null : readRecordedExperiment(run.challengeExperiment);
  const definition = run.challengeId && run.challengeVersion ? findChallenge(run.challengeId, run.challengeVersion)?.definition : null;
  const scenario = run.challengeScenario == null ? null : definition ? verifiedScenario(run.challengeScenario, definition, input) : null;
  if (run.challengeScenario != null && !scenario) throw new ConflictError("The recorded scenario is unavailable.");
  res.json({ success: true, browserRun: { input, horizonSeconds, stopAtSecond: run.evaluationStopAtSimulatedSeconds ?? horizonSeconds,
    ...(run.challengeId ? {challengeId: run.challengeId} : {}), ...(scenario ? {scenario: {version: scenario.version, visibility: scenario.visibility, steps: scenario.steps}} : {}),
    ...(plan ? { experiment: { fault: plan.fault, resourceId: plan.targetResourceId, atSimulatedSecond: plan.atSimulatedSecond } } : {}) } });
});

// The browser finished a Model 2 run: store what it did and queue the server's replay, which alone becomes the record.
deploymentRouter.post("/:deploymentId/submit", async (req, res) => {
  const parsed = DeploymentIdSchema.safeParse(req.params);
  if (!parsed.success) throw new ValidationError("A valid deployment ID is required.");
  const id = parsed.data.deploymentId;
  await prisma.$transaction(async (tx) => {
    await admitReplay(tx);
    await tx.$queryRaw`SELECT id FROM "Deployment" WHERE id = ${id} FOR UPDATE`;
    const run = await tx.deployment.findFirst({ where: { id, ownerId: res.locals.userId } });
    if (!run) throw new NotFoundError("Run not found");
    if (run.status !== DeploymentStatus.BROWSER) throw new ConflictError("This run is not waiting for a browser submission.");
    const allowance = executionAllowance(run.autoStopAtSimulatedSeconds ?? run.evaluationStopAtSimulatedSeconds);
    const submission = checkSubmission(req.body, { horizonSeconds: runtimeHorizon(allowance.durationSeconds), challenge: run.challengeId !== null });
    await tx.deployment.update({ where: { id }, data: { browserSubmission: storedJson(submission), status: DeploymentStatus.PENDING } });
    await tx.outbox.create({ data: { eventType: "deployment-replay", payload: { deploymentId: id } } });
  });
  res.status(202).json({ success: true, message: "Submitted. The server is replaying the run for the official result." });
});

// The browser stopped before its first second: nothing ran, so the run closes without a record.
deploymentRouter.post("/:deploymentId/cancel", async (req, res) => {
  const parsed = DeploymentIdSchema.safeParse(req.params);
  if (!parsed.success) throw new ValidationError("A valid deployment ID is required.");
  const closed = await prisma.$executeRaw`UPDATE "Deployment" SET status = 'failed', "updatedAt" = CURRENT_TIMESTAMP,
    timeline = COALESCE(timeline::jsonb, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'timestamp', CURRENT_TIMESTAMP, 'event', 'Deployment Failed', 'message', 'Stopped before its first simulated second; nothing was recorded.'::text))
    WHERE id = ${parsed.data.deploymentId} AND "ownerId" = ${res.locals.userId} AND status = 'browser'`;
  if (!closed) throw new ConflictError("This run is not waiting for the browser.");
  res.json({ success: true });
});
