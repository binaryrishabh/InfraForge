import { Router } from "express";
import { prisma } from "../lib/prisma";
import { ValidationError, NotFoundError } from "../utils/errors";
import { assertNoActiveRuns } from "../deployments/designDeletion";
import { InfrastructureIdSchema, InfrastructureBodySchema, UpdateInfrastructureBodySchema } from "../zod_schemas/infrastructure.schema";

export const infrastructureRouter = Router();

// Create new infrastructure
infrastructureRouter.post("/", async (req, res) => {
  const infrastructureResult = InfrastructureBodySchema.safeParse(req.body);
  if (!infrastructureResult.success) {
    const errorMessages = infrastructureResult.error.issues.map(err => err.message).join(", ");
    throw new ValidationError(errorMessages);
  }
  const { name, layout } = infrastructureResult.data;
  const createdInfrastructure = await prisma.infrastructure.create({
    data: {
      name,
      userId: res.locals.userId,
      ownerId: res.locals.userId,
      layout: layout || {}
    }
  });
  res.status(201).json({
    success: true,
    message: "The infrastructure created successfully",
    createdInfrastructure
  });
});

// Get all infrastructure
infrastructureRouter.get("/", async (req, res) => {
  const allInfrastructure = await prisma.infrastructure.findMany({
    where: { ownerId: res.locals.userId },
    orderBy: { createdAt: "desc" }
  });
  res.status(200).json({
    success: true,
    message: "Get all infrastructure",
    allInfrastructure
  });
});

// Get one infrastructure
infrastructureRouter.get("/:infrastructureId", async (req, res) => {
  const InfrastructureId = InfrastructureIdSchema.safeParse(req.params);
  if (!InfrastructureId.success) {
    const errorMessages = InfrastructureId.error.issues.map(err => err.message).join(", ");
    throw new ValidationError(errorMessages);
  }
  const { infrastructureId } = InfrastructureId.data;
  const infrastructure = await prisma.infrastructure.findUnique({
    where: { id: infrastructureId, ownerId: res.locals.userId }
  });
  if (!infrastructure) {
    throw new NotFoundError("Infrastructure not found with the given id");
  }
  res.status(200).json({
    success: true,
    message: "The infrastructure successfully fetched",
    infrastructure
  });
});

// Update infrastructure
infrastructureRouter.put("/:infrastructureId", async (req, res) => {
  const InfrastructureId = InfrastructureIdSchema.safeParse(req.params);
  if (!InfrastructureId.success) {
    const errorMessages = InfrastructureId.error.issues.map(err => err.message).join(", ");
    throw new ValidationError(errorMessages);
  }
  const { infrastructureId } = InfrastructureId.data;
  const infrastructureResult = UpdateInfrastructureBodySchema.safeParse(req.body);
  if (!infrastructureResult.success) {
    const errorMessages = infrastructureResult.error.issues.map(err => err.message).join(", ");
    throw new ValidationError(errorMessages);
  }
  const updatedInfrastructure = await prisma.infrastructure.update({
    where: { id: infrastructureId, ownerId: res.locals.userId },
    data: infrastructureResult.data
  });
  res.status(200).json({
    success: true,
    message: "Infrastructure successfully updated",
    updatedInfrastructure
  });
});

// Delete one infrastructure
infrastructureRouter.delete("/:infrastructureId", async (req, res) => {
  const InfrastructureId = InfrastructureIdSchema.safeParse(req.params);
  if (!InfrastructureId.success) {
    const errorMessages = InfrastructureId.error.issues.map(err => err.message).join(", ");
    throw new ValidationError(errorMessages);
  }
  const { infrastructureId } = InfrastructureId.data;
  const deletedInfrastructure = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Infrastructure" WHERE id = ${infrastructureId} FOR UPDATE`;
    if (!await tx.infrastructure.findUnique({ where: { id: infrastructureId, ownerId: res.locals.userId } })) {
      throw new NotFoundError("Infrastructure not found");
    }
    await assertNoActiveRuns(tx, infrastructureId);
    return tx.infrastructure.delete({ where: { id: infrastructureId, ownerId: res.locals.userId } });
  });
  return res.status(200).json({
    success: true,
    message: "Infrastructure deleted successfully!",
    deletedInfrastructure
  });
});

// All deployments of an infrastructure
infrastructureRouter.get("/:infrastructureId/deployments", async (req, res) => {
  const InfrastructureId = InfrastructureIdSchema.safeParse(req.params);
  if (!InfrastructureId.success) {
    const errorMessages = InfrastructureId.error.issues.map(err => err.message).join(", ");
    throw new ValidationError(errorMessages);
  }
  const { infrastructureId } = InfrastructureId.data;
  const infrastructure = await prisma.infrastructure.findUnique({
    where: { id: infrastructureId, ownerId: res.locals.userId },
    include: { deployments: true }
  });
  if (!infrastructure) {
    throw new NotFoundError("No infrastructure found with the provided infrastructure id");
  }
  const deployments = infrastructure.deployments;
  res.status(200).json({
    success: true,
    message: "Fetched all the deployments related to the provided infrastructure id",
    deployments
  });
});
