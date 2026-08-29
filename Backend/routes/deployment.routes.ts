import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { redis } from "../infra/redis";
import { ValidationError, NotFoundError } from "../utils/errors";
import { ChaosInjectionBodySchema, DeploymentIdSchema, LoadControlBodySchema, DeploymentCreateBodySchema, VerticalScaleBodySchema } from "../zod_schemas/deployment.schema";
import { DeploymentStatus } from "@shared/enum/DeploymentStatus.enum";
import { Publish } from "@shared/enum/Publish.enum";

export const deploymentRouter = Router();

// Create new deployment — transactional outbox
deploymentRouter.post("/", async (req, res) => {
  const DeploymentBody = DeploymentCreateBodySchema.safeParse(req.body);
  if (!DeploymentBody.success) {
    const errorMessages = DeploymentBody.error.issues.map(err => err.message).join(", ");
    throw new ValidationError(errorMessages);
  }
  const { infrastructureId, workloadProfile } = DeploymentBody.data;
  const infrastructure = await prisma.infrastructure.findUnique({
    where: { id: infrastructureId }
  });
  if (!infrastructure) {
    throw new NotFoundError("Infrastructure not found with the given id.");
  }
  const resources = (infrastructure.layout as any).resources || [];
  const resourceCount = resources.length;
  const deploymentId = crypto.randomUUID();
  const [createdDeployment] = await prisma.$transaction([
    prisma.deployment.create({
      data: {
        id: deploymentId,
        infrastructureId,
        resourceCount,
        workloadProfile
      }
    }),
    prisma.outbox.create({
      data: {
        eventType: "deployment-created",
        payload: {
          deploymentId,
          resources
        }
      }
    })
  ]);
  res.status(201).json({
    success: true,
    message: "The deployment created successfully",
    createdDeployment
  });
});

// Get details of existing deployment
deploymentRouter.get("/:deploymentId", async (req, res) => {
  const DeploymentId = DeploymentIdSchema.safeParse(req.params);
  if (!DeploymentId.success) {
    const errorMessages = DeploymentId.error.issues.map(err => err.message).join(", ");
    throw new ValidationError(errorMessages);
  }
  const { deploymentId } = DeploymentId.data;
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId }
  });
  if (!deployment) {
    throw new NotFoundError("No deployment with the specification id: " + deploymentId);
  }
  res.status(200).json({
    success: true,
    message: "We have fetched the deployment successfully",
    deployment
  });
});

// Chaos injection
deploymentRouter.post("/:deploymentId/chaos", async (req, res) => {
  const DeploymentId = DeploymentIdSchema.safeParse(req.params);
  if (!DeploymentId.success) {
    const errorMessages = DeploymentId.error.issues.map(err => err.message).join(", ");
    throw new ValidationError(errorMessages);
  }
  const ChaosInjectionData = ChaosInjectionBodySchema.safeParse(req.body);
  if (!ChaosInjectionData.success) {
    const errorMessages = ChaosInjectionData.error.issues.map(err => err.message).join(", ");
    throw new ValidationError(errorMessages);
  }
  const { deploymentId } = DeploymentId.data;
  const { type, resourceId } = ChaosInjectionData.data;
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId }
  });
  if (!deployment) {
    throw new NotFoundError("Deployment not found with specified id " + deploymentId);
  }
  if (deployment.status !== DeploymentStatus.LIVE) {
    throw new ValidationError("Chaos can only be injected into a live deployment");
  }

  const timestamp = new Date().toISOString();
  const message = `Chaos ${type} injected on ${resourceId}`;

  await prisma.$transaction(async (tx) => {
    const latestDeployment = await tx.deployment.findUnique({
      where: { id: deploymentId }
    });

    const currentChaosEvents = (latestDeployment?.chaosEvents as any[]) || [];
    currentChaosEvents.push({
      timestamp,
      type,
      resourceId,
      message
    });

    const currentTimeline = (latestDeployment?.timeline as any[]) || [];
    currentTimeline.push({
      timestamp,
      event: "Chaos Injected",
      message
    });

    await tx.deployment.update({
      where: { id: deploymentId },
      data: {
        chaosEvents: currentChaosEvents,
        timeline: currentTimeline
      }
    });
  });

  // Publish to deployment updates channel for frontend timeline
  await redis.publish(`deployment:${deploymentId}:updates`, JSON.stringify({
    deploymentId,
    chaosType: type,
    resourceId,
    message,
    timestamp,
    publishType: Publish.publishChaosInjected
  }));

  // Publish to simulator control channel
  await redis.publish("simulator:control", JSON.stringify({
    deploymentId,
    action: "inject-chaos",
    chaosType: type,
    resourceId
  }));

  res.status(200).json({
    success: true,
    message: "Chaos injected",
    deploymentId
  });
});

// Load control — sets the load target of a LIVE deployment's simulation
deploymentRouter.post("/:deploymentId/load", async (req, res) => {
  const DeploymentId = DeploymentIdSchema.safeParse(req.params);
  if (!DeploymentId.success) {
    const errorMessages = DeploymentId.error.issues.map(err => err.message).join(", ");
    throw new ValidationError(errorMessages);
  }
  const LoadControlData = LoadControlBodySchema.safeParse(req.body);
  if (!LoadControlData.success) {
    const errorMessages = LoadControlData.error.issues.map(err => err.message).join(", ");
    throw new ValidationError(errorMessages);
  }
  const { deploymentId } = DeploymentId.data;
  const { targetLoadFraction } = LoadControlData.data;
  const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId } });
  if (!deployment) {
    throw new NotFoundError("Deployment not found with specified id " + deploymentId);
  }
  if (deployment.status !== DeploymentStatus.LIVE) {
    throw new ValidationError("Load can only be adjusted on a live deployment");
  }
  await redis.publish("simulator:control", JSON.stringify({
    deploymentId,
    action: "set-load",
    targetLoadFraction
  }));
  res.status(200).json({
    success: true,
    message: `Load target set to ${Math.round(targetLoadFraction * 100)}% of declared capacity`,
    targetLoadFraction
  });
});

// Vertical scaling — swaps a resource's SKU with realistic restart downtime
deploymentRouter.post("/:deploymentId/scale-vertical", async (req, res) => {
  const DeploymentId = DeploymentIdSchema.safeParse(req.params);
  if (!DeploymentId.success) {
    const errorMessages = DeploymentId.error.issues.map(err => err.message).join(", ");
    throw new ValidationError(errorMessages);
  }
  const VerticalScaleData = VerticalScaleBodySchema.safeParse(req.body);
  if (!VerticalScaleData.success) {
    const errorMessages = VerticalScaleData.error.issues.map(err => err.message).join(", ");
    throw new ValidationError(errorMessages);
  }
  const { deploymentId } = DeploymentId.data;
  const { resourceId, skuId } = VerticalScaleData.data;
  const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId } });
  if (!deployment) {
    throw new NotFoundError("Deployment not found with specified id " + deploymentId);
  }
  if (deployment.status !== DeploymentStatus.LIVE) {
    throw new ValidationError("Vertical scaling only applies to a live deployment");
  }
  await redis.publish("simulator:control", JSON.stringify({
    deploymentId,
    action: "scale-vertical",
    resourceId,
    skuId
  }));
  res.status(200).json({
    success: true,
    message: "Vertical scaling initiated",
    deploymentId
  });
});

// Teardown — stops the simulation and retires the deployment
deploymentRouter.post("/:deploymentId/teardown", async (req, res) => {
  const DeploymentId = DeploymentIdSchema.safeParse(req.params);
  if (!DeploymentId.success) {
    const errorMessages = DeploymentId.error.issues.map(err => err.message).join(", ");
    throw new ValidationError(errorMessages);
  }
  const { deploymentId } = DeploymentId.data;
  const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId } });
  if (!deployment) {
    throw new NotFoundError("Deployment not found with specified id " + deploymentId);
  }
  if (deployment.status !== DeploymentStatus.LIVE) {
    throw new ValidationError("Only live deployments can be torn down");
  }
  const tornTimeline = (deployment.timeline as any[]) || [];
  tornTimeline.push({
    timestamp: new Date().toISOString(),
    event: "Deployment Torn Down",
    message: "Environment torn down. Simulation stopped."
  });
  await prisma.deployment.update({
    where: { id: deploymentId },
    data: { status: DeploymentStatus.TORN_DOWN, timeline: tornTimeline }
  });
  await redis.publish("simulator:control", JSON.stringify({
    deploymentId,
    action: "stop"
  }));
  await redis.publish(`deployment:${deploymentId}:updates`, JSON.stringify({
    deploymentId,
    publishType: Publish.publishDeploymentTornDown,
    status: "torn-down",
    message: "Environment torn down. Simulation stopped.",
    timestamp: new Date().toISOString()
  }));
  res.status(200).json({
    success: true,
    message: "Deployment torn down",
    deploymentId
  });
});