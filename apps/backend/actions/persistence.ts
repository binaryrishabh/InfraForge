import { requireCapability } from "../capabilities/policy";
import type { ActionRequest } from "@infraforge/contracts/actions";
import { prisma } from "../lib/prisma";
import { storedJson } from "../utils/json";
import { LayoutSchema } from "../zod_schemas/layout.schema";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors";
import { readActionRequest, actionDto } from "./contract";
import { validateActionTarget } from "./targets";

export const OPEN_ACTION_STATUSES = ["requested", "applying", "running"];

export async function requestRunAction(deploymentId: string, ownerId: string, input: ActionRequest) {
  let request: ActionRequest;
  try { request = readActionRequest(input); } catch { throw new ValidationError("Invalid or oversized action parameters."); }
  // Only the worker records a challenge's scheduled fault; a person's request can never claim that origin.
  if (request.kind === "chaos" && ["memory-leak", "disk-failure"].includes(request.parameters.type)) throw new ValidationError("This legacy fault is decoded for recorded runs but is unavailable as a new control.");
  if (request.kind === "chaos" && request.parameters.trigger !== undefined) throw new ValidationError("Faults requested here cannot carry a system trigger.");
  if (request.kind === "teardown" && request.parameters.trigger === "operational-limit") throw new ValidationError("Operational stops are worker-owned.");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Deployment" WHERE id = ${deploymentId} AND "ownerId" = ${ownerId} FOR UPDATE`;
    const run = await tx.deployment.findUnique({ where: { id: deploymentId, ownerId } });
    if (!run) throw new NotFoundError("Run not found");
    const open = await tx.runAction.findMany({ where: { deploymentId, status: { in: OPEN_ACTION_STATUSES } }, orderBy: { sequence: "asc" } });
    const stopping = open.find((a) => a.kind === "teardown");
    if (request.kind === "teardown") {
      if (stopping) return actionDto(stopping);
      if (run.status === "torn-down") {
        const done = await tx.runAction.findFirst({ where: { deploymentId, kind: "teardown", status: "completed" }, orderBy: { sequence: "desc" } });
        if (done) return actionDto(done);
      }
    }
    if (run.status !== "live" || !run.runtimeActive) throw new ConflictError("Actions require a live run.");
    if (run.browserSubmission !== null) throw new ConflictError("The server is replaying this browser run; it finishes by itself.");
    if (stopping) throw new ConflictError("This run is stopping; no further controls are accepted.");
    // A challenge attempt is evaluated under its fixed conditions; only pacing and stopping stay available.
    if (run.challengeId && request.kind !== "speed" && request.kind !== "teardown") {
      throw new ConflictError("Challenge attempts run under fixed conditions. Only speed and stop are available.");
    }
    const escape = request.kind === "teardown" || (request.kind === "speed" && !open.some((a) => a.kind === "speed"));
    if ((!escape && open.length >= 128) || run.actionSequence >= (request.kind === "teardown" ? 2147483647 : 2147483646)) {
      throw new ConflictError("Run action capacity reached; wait for pending actions or stop the run.");
    }
    const topology = LayoutSchema.parse(run.liveTopology);
    validateActionTarget(request, topology);
    if (request.kind !== "teardown") requireCapability(ownerId, { capability: "run.control", runId: deploymentId, control: request.kind });
    if (request.kind === "topology") {
      if (request.parameters.expectedRevision !== run.topologyRevision) throw new ConflictError("Live topology changed. Re-enter the environment before editing again.");
      request = { ...request, parameters: { ...request.parameters, acceptedRevision: run.topologyRevision + 1 } };
      await tx.deployment.update({ where: { id: deploymentId }, data: {
        liveTopology: storedJson({ resources: request.parameters.resources, connectionLines: request.parameters.connectionLines }),
        topologyRevision: { increment: 1 },
      } });
    }
    const sequenced = await tx.deployment.update({ where: { id: deploymentId }, data: { actionSequence: { increment: 1 } } });
    return actionDto(await tx.runAction.create({ data: { deploymentId, sequence: sequenced.actionSequence,
      kind: request.kind, parameters: storedJson(request.parameters) } }));
  });
}
