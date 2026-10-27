import { admitDeployment } from "../deployments/admission";
import { requireCapability } from "../capabilities/policy";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { NotFoundError, ValidationError, ConflictError } from "../utils/errors";
import { reportSelection } from "../reports/routes";
import { buildRerunOptions, currentDesignInput, rerunInputHash } from "./options";
import { readRunInputs, runsOnModel2 } from "../deployments/runInputs";
import { storedJson } from "../utils/json";
import { LayoutSchema } from "../zod_schemas/layout.schema";

export const rerunRouter = Router();
const sourceId = (v: unknown) => { const id = z.uuid().safeParse(v); if (!id.success) throw new ValidationError("A valid source run ID is required."); return id.data; };
rerunRouter.get("/:id/rerun-options", async (req, res) => {
  const id = sourceId(req.params.id);
  const options = await prisma.$transaction(async (tx) => {
    const source = await tx.deployment.findFirst({ where: { id, ownerId: res.locals.userId }, select: reportSelection });
    if (!source) throw new NotFoundError("Run not found");
    const design = source.infrastructureId ? await tx.infrastructure.findFirst({ where: { id: source.infrastructureId, ownerId: res.locals.userId } }) : null;
    return buildRerunOptions(source, design?.layout ?? null);
  }, { isolationLevel: "RepeatableRead" });
  res.json({ success: true, options });
});
const previewBody = z.object({ layout: LayoutSchema.extend({
  resources: LayoutSchema.shape.resources.unwrap().min(1).max(500),
  connectionLines: LayoutSchema.shape.connectionLines.unwrap().max(1000),
}) }).strict();
rerunRouter.post("/:id/rerun-preview", async (req, res) => {
  const id = sourceId(req.params.id), parsed = previewBody.safeParse(req.body);
  if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > 65536) throw new ValidationError("A bounded current canvas layout is required.");
  const options = await prisma.$transaction(async (tx) => {
    const source = await tx.deployment.findFirst({ where: { id, ownerId: res.locals.userId }, select: reportSelection });
    if (!source) throw new NotFoundError("Run not found");
    const design = source.infrastructureId ? await tx.infrastructure.findFirst({ where: { id: source.infrastructureId, ownerId: res.locals.userId }, select: { id: true } }) : null;
    return buildRerunOptions(source, design ? parsed.data.layout : null);
  }, { isolationLevel: "RepeatableRead" });
  res.json({ success: true, options });
});
const creation = z.object({ mode: z.enum(["exact", "current-design"]), matchedStop: z.boolean(), expectedInputHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
rerunRouter.post("/:id/reruns", async (req, res) => {
  const id = sourceId(req.params.id), body = creation.safeParse(req.body);
  if (!body.success) throw new ValidationError("Choose exact/current-design, matched stop and the current design preview hash.");
  const run = await prisma.$transaction(async (tx) => {
    // Consistent design→run lock order matches design deletion and ordinary creation.
    const identity = await tx.deployment.findFirst({ where: { id, ownerId: res.locals.userId }, select: { infrastructureId: true } });
    if (!identity) throw new NotFoundError("Run not found");
    if (identity.infrastructureId) await tx.$queryRaw`SELECT id FROM "Infrastructure" WHERE id = ${identity.infrastructureId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Deployment" WHERE id = ${id} AND "ownerId" = ${res.locals.userId} FOR SHARE`;
    const source = await tx.deployment.findFirst({ where: { id, ownerId: res.locals.userId }, select: reportSelection });
    if (!source) throw new NotFoundError("Run not found");
    const design = source.infrastructureId ? await tx.infrastructure.findFirst({ where: { id: source.infrastructureId, ownerId: res.locals.userId } }) : null;
    const options = buildRerunOptions(source, design?.layout ?? null);
    const mode = body.data.mode;
    const option = mode === "exact" ? options.exact : options.currentDesign;
    if (!option.available) throw new ConflictError(option.reason ?? "Rerun unavailable.");
    if (body.data.matchedStop && !options.matchedStop.available) throw new ConflictError(options.matchedStop.reason!);
    const input = readRunInputs(source.runInputs);
    const runInputs = mode === "exact" ? input : currentDesignInput(input, design!.layout);
    if (mode === "current-design" && body.data.expectedInputHash !== rerunInputHash(runInputs)) throw new ConflictError("The saved design changed since preview. Refresh the preview before running.");
    requireCapability(res.locals.userId, { capability: "run.start", purpose: "engineer", engine: runsOnModel2(runInputs) ? "2" : "1", profile: runInputs.version === 2 ? runInputs.simulationModelVersion : null, durationSeconds: body.data.matchedStop ? options.matchedStop.target : null });
    const created = await admitDeployment(tx, { infrastructureId: source.infrastructureId, ownerId: res.locals.userId,
      runName: source.runName, sourceRunId: source.id, rerunMode: mode,
      autoStopAtSimulatedSeconds: body.data.matchedStop ? options.matchedStop.target : null,
      resourceCount: runInputs.resources.length, runInputs: storedJson(runInputs), workloadProfile: storedJson(runInputs.workloadProfile), seed: runInputs.seed,
      liveTopology: storedJson({ resources: runInputs.resources, connectionLines: runInputs.connectionLines }) });
    return created;
  });
  res.status(201).json({ success: true, createdDeployment: run });
});
