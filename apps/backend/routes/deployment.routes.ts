import { Router } from "express";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { ValidationError, NotFoundError } from "../utils/errors";
import { DeploymentCreateBodySchema, DeploymentIdSchema } from "../zod_schemas/deployment.schema";
import { captureRunInputs } from "../deployments/runInputs";
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
    const run = await tx.deployment.create({ data: { id: randomUUID(), infrastructureId,
      ownerId: infrastructure.ownerId, runName: infrastructure.name,
      resourceCount: runInputs.resources.length, workloadProfile: runInputs.workloadProfile,
      seed: runInputs.seed, runInputs,
      liveTopology: { resources: runInputs.resources, connectionLines: runInputs.connectionLines } } });
    await tx.outbox.create({ data: { eventType: "deployment-created", payload: { deploymentId: run.id } } });
    return run;
  });
  res.status(201).json({ success: true, message: "Deployment created", createdDeployment });
});

deploymentRouter.get("/live", async (_req, res) => {
  const rows = await prisma.deployment.findMany({ where: { status: "live", ownerId: res.locals.userId }, orderBy: { updatedAt: "desc" } });
  res.json({ success: true, deployments: rows.map((run) => ({ id: run.id, infrastructureId: run.infrastructureId,
    infrastructureName: run.runName ?? "Unnamed legacy run", resourceCount: run.resourceCount,
    status: run.status, createdAt: run.createdAt, updatedAt: run.updatedAt })) });
});

deploymentRouter.get("/:deploymentId", async (req, res) => {
  const parsed = DeploymentIdSchema.safeParse(req.params);
  if (!parsed.success) throw new ValidationError("A valid deployment ID is required.");
  const deployment = await prisma.deployment.findUnique({ where: { id: parsed.data.deploymentId, ownerId: res.locals.userId } });
  if (!deployment) throw new NotFoundError("Run not found");
  res.json({ success: true, deployment });
});
