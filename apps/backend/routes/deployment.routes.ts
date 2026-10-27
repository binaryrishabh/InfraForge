import { admitDeployment } from "../deployments/admission";
import { authorizeCapability, requireCapability } from "../capabilities/policy";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { ValidationError, NotFoundError } from "../utils/errors";
import { DeploymentCreateBodySchema, DeploymentIdSchema } from "../zod_schemas/deployment.schema";
import { captureRunInputs } from "../deployments/runInputs";
import { hasInternalGrant } from "../internalModel2/store";
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
  // Model 2 live runs open to granted accounts first; everyone moves to Model 2 when Model 1 is removed.
  const engine = await hasInternalGrant(res.locals.userId) ? "2" : "1";
  const createdDeployment = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Infrastructure" WHERE id = ${infrastructureId} FOR UPDATE`;
    const infrastructure = await tx.infrastructure.findUnique({ where: { id: infrastructureId, ownerId: res.locals.userId } });
    if (!infrastructure) throw new NotFoundError("Infrastructure not found");
    const runInputs = captureRunInputs(infrastructure.layout, workloadProfile, undefined, engine);
    requireCapability(infrastructure.ownerId!, { capability: "run.start", purpose: "engineer", engine, profile: runInputs.simulationModelVersion, durationSeconds: null });
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
  res.json({ success: true, availability: {
    run: authorizeCapability(subject, { capability: "run.start", purpose: "engineer", engine: "1", profile: null, durationSeconds: null }),
    save: authorizeCapability(subject, { capability: "design.persist", operation: "create", countDelta: 1 }),
    export: authorizeCapability(subject, { capability: "artifact.export", artifactId: "availability", format: "html", scope: "run" }),
  } });
});

deploymentRouter.get("/live", async (_req, res) => {
  const rows = await prisma.deployment.findMany({ where: { status: "live", ownerId: res.locals.userId }, orderBy: { updatedAt: "desc" } });
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
