import { Router } from "express";
import { prisma } from "../lib/prisma";
import { ValidationError, NotFoundError } from "../utils/errors";
import { config } from "../utils/config";
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
    orderBy: { createdAt: "desc" }
  });
  if (allInfrastructure.length === 0) {
    throw new NotFoundError("No Infrastructure created yet");
  }
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
    where: { id: infrastructureId }
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
    where: { id: infrastructureId },
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
  const deletedInfrastructure = await prisma.infrastructure.delete({
    where: { id: infrastructureId }
  });
  return res.status(200).json({
    success: true,
    message: "Infrastructure deleted successfully!",
    deletedInfrastructure
  });
});

// Delete all — development only
if (config.NODE_ENV !== "production") {
  infrastructureRouter.delete("/", async (req, res) => {
    const allDeletedInfrastructure = await prisma.infrastructure.deleteMany();
    if (allDeletedInfrastructure.count === 0) {
      throw new NotFoundError("No infrastructure found to delete");
    }
    res.status(200).json({
      success: true,
      message: "All infrastructure deleted",
      allDeletedInfrastructure
    });
  });
}

// All deployments of an infrastructure
infrastructureRouter.get("/:infrastructureId/deployments", async (req, res) => {
  const InfrastructureId = InfrastructureIdSchema.safeParse(req.params);
  if (!InfrastructureId.success) {
    const errorMessages = InfrastructureId.error.issues.map(err => err.message).join(", ");
    throw new ValidationError(errorMessages);
  }
  const { infrastructureId } = InfrastructureId.data;
  const infrastructure = await prisma.infrastructure.findUnique({
    where: { id: infrastructureId },
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