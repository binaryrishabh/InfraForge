import { requireCapability } from "../capabilities/policy";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { LayoutSchema } from "../zod_schemas/layout.schema";
import { NotFoundError, ConflictError, ValidationError } from "../utils/errors";
import { storedJson } from "../utils/json";
import { captureRunInputs } from "../deployments/runInputs";
import { improvementSource } from "./improvements";
import { reviewDesignChanges } from "./designChanges";

export const improvementRouter = Router();
const sourceBody = z.object({ sourceRunId: z.uuid() }).strict();
const previewBody = sourceBody.extend({ infrastructureId: z.uuid(), layout: LayoutSchema.extend({
  resources: LayoutSchema.shape.resources.unwrap().max(500), connectionLines: LayoutSchema.shape.connectionLines.unwrap().max(1000),
}) }).strict();

// A new workspace starts at the actual captured design, preserving existing designs
// and avoiding silent replacement with today's saved topology.
improvementRouter.post("/:id/improvement-workspace", async (req, res) => {
  const body = sourceBody.safeParse(req.body);
  if (!body.success) throw new ValidationError("A source attempt is required.");
  const ownerId: string = res.locals.userId;
  const design = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Deployment" WHERE id = ${body.data.sourceRunId} AND "ownerId" = ${ownerId} FOR SHARE`;
    const source = await tx.deployment.findFirst({ where: { id: body.data.sourceRunId, ownerId } });
    if (!source) throw new NotFoundError("Source attempt not found");
    const { definition, input } = improvementSource(source, String(req.params.id));
    requireCapability(ownerId, { capability: "design.persist", operation: "create", countDelta: 1 });
    return tx.infrastructure.create({ data: { ownerId, userId: ownerId, name: definition.title,
      challengeId: definition.id, challengeVersion: definition.version,
      layout: storedJson({ resources: input.resources, connectionLines: input.connectionLines, layoutVersion: 3 }) } });
  });
  res.status(201).json({ success: true, infrastructure: design });
});

improvementRouter.post("/:id/improvement-preview", async (req, res) => {
  const body = previewBody.safeParse(req.body);
  if (!body.success || Buffer.byteLength(JSON.stringify(body.data), "utf8") > 65536) throw new ValidationError("A bounded design and source attempt are required.");
  const ownerId: string = res.locals.userId;
  const result = await prisma.$transaction(async (tx) => {
    const source = await tx.deployment.findFirst({ where: { id: body.data.sourceRunId, ownerId } });
    if (!source) throw new NotFoundError("Source attempt not found");
    const { definition, input } = improvementSource(source, String(req.params.id));
    const design = await tx.infrastructure.findFirst({ where: { id: body.data.infrastructureId, ownerId } });
    if (!design) throw new NotFoundError("Design not found");
    if (design.challengeId !== definition.id || design.challengeVersion !== definition.version) throw new ConflictError("The design must belong to the source's exact challenge version.");
    const current = captureRunInputs(body.data.layout, definition.workload, input.seed, definition.engine);
    return reviewDesignChanges(input, current);
  }, { isolationLevel: "RepeatableRead" });
  res.json({ success: true, review: result });
});
