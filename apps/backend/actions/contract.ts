import { z } from "zod";
import type { ActionRequest, RunAction } from "@infraforge/contracts/actions";
import type { RunAction as StoredAction } from "../lib/generated/prisma/client";
import { interventionError, type InterventionRequest } from "@infraforge/domain/resource";
import { LiveTopologySchema } from "../zod_schemas/layout.schema";

const id = z.string().min(1).max(256);
const amount = z.number().finite().nonnegative();
const intervention = z.custom<InterventionRequest>(value => interventionError(value) === null);
const receipt = z.object({ interventionId: id, revision: z.number().int().positive(),
  target: z.union([z.object({resourceId: id}).strict(), z.object({edgeId: id, direction: z.enum(["request", "response", "both"])}).strict()]),
  parameters: z.record(z.string(), z.union([z.number().finite(), z.boolean(), z.string()])),
  actionId: id, resolvedTargets: z.array(id).min(1).max(2048), affectedPaths: z.array(id).max(2048), atUs: amount.int(), endUs: amount.int().nullable(),
}).strict().refine(value => interventionError({interventionId: value.interventionId, revision: value.revision, target: value.target, parameters: value.parameters}) === null);
const outcomeSchema = z.object({ intervention: receipt.optional(), interventionEnded: z.boolean().optional(), previousTarget: amount.optional(), appliedTarget: amount.optional(),
  previousSpeed: amount.optional(), appliedSpeed: amount.optional(), durationSimulatedSeconds: amount.optional(),
  faultEnded: z.boolean().optional(), observedOverallHealth: z.enum(["healthy", "degraded", "saturated", "critical"]).optional(),
  baselineOverallHealth: z.enum(["healthy", "degraded", "saturated", "critical"]).optional(),
  fromSkuId: id.nullable().optional(), requestedSkuId: id.optional(), installedSkuId: id.optional(), online: z.boolean().optional(),
  delta: z.union([z.literal(1), z.literal(-1)]).optional(), previousReplicaCount: amount.optional(), finalReplicaCount: amount.optional(),
  replicaId: id.optional(), acceptedRevision: amount.optional(), appliedRevision: amount.optional(),
  capturedAt: z.iso.datetime({ offset: true }).optional() }).strict();
const topology = LiveTopologySchema.extend({
  resources: LiveTopologySchema.shape.resources.max(500),
  connectionLines: LiveTopologySchema.shape.connectionLines.max(1000),
  expectedRevision: z.number().int().nonnegative(), acceptedRevision: z.number().int().positive().optional(),
}).strict();
export const ActionRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("intervention"), parameters: intervention }).strict(),
  z.object({ kind: z.literal("load"), parameters: z.object({ targetLoadFraction: z.number().min(0).max(2) }).strict() }),
  z.object({ kind: z.literal("speed"), parameters: z.object({ speed: z.union([z.literal(0), z.literal(1), z.literal(10), z.literal(60)]) }).strict() }),
  z.object({ kind: z.literal("chaos"), parameters: z.object({ type: z.enum(["crash", "cpu-spike", "network-delay", "memory-leak", "disk-failure"]), resourceId: id,
    trigger: z.literal("challenge-experiment").optional() }).strict() }),
  z.object({ kind: z.literal("vertical-scale"), parameters: z.object({ resourceId: id, skuId: id }).strict() }),
  z.object({ kind: z.literal("pool-scale"), parameters: z.object({ lbId: id, delta: z.union([z.literal(1), z.literal(-1)]) }).strict() }),
  z.object({ kind: z.literal("topology"), parameters: topology }),
  z.object({ kind: z.literal("teardown"), parameters: z.object({ trigger: z.enum(["matched-stop", "challenge-evaluation", "operational-limit"]).optional() }).strict() }),
]);
export function readActionRequest(value: unknown): ActionRequest {
  const request = ActionRequestSchema.parse(value);
  if (Buffer.byteLength(JSON.stringify(request.parameters), "utf8") > 65536) throw new Error("Action parameters exceed the bounded contract");
  return request;
}

export function actionDto(row: StoredAction): RunAction {
  const request = readActionRequest({ kind: row.kind, parameters: row.parameters });
  const status = z.enum(["requested", "applying", "running", "completed", "failed", "cancelled"]).parse(row.status);
  const outcome = row.outcome == null ? null : outcomeSchema.parse(row.outcome);
  z.number().int().positive().parse(row.sequence);
  amount.int().nullable().parse(row.appliedSimulatedSeconds);
  amount.int().nullable().parse(row.completedSimulatedSeconds);
  if ((status === "running" || status === "completed") && (!row.appliedAt || row.appliedSimulatedSeconds === null)) throw new Error("Successful action lacks application evidence");
  if (["completed", "failed", "cancelled"].includes(status) && !row.completedAt) throw new Error("Closed action lacks completion evidence");
  if (status === "completed" && row.completedSimulatedSeconds === null) throw new Error("Completed action lacks simulated completion time");
  if (row.appliedSimulatedSeconds !== null && row.completedSimulatedSeconds !== null && row.completedSimulatedSeconds < row.appliedSimulatedSeconds) throw new Error("Action completion precedes application");
  if (status === "running" || status === "completed") {
    // A successful phase needs its specific evidence, not an empty generic object.
    switch (request.kind) {
      case "intervention": {
        const recorded = receipt.parse(outcome?.intervention);
        if (JSON.stringify({interventionId: recorded.interventionId, revision: recorded.revision, target: recorded.target, parameters: recorded.parameters}) !== JSON.stringify(request.parameters)) {
          // Compare structurally: JSON object key order is not semantic.
          if (recorded.interventionId !== request.parameters.interventionId || recorded.revision !== request.parameters.revision ||
            JSON.stringify(Object.entries(recorded.target).sort()) !== JSON.stringify(Object.entries(request.parameters.target).sort()) ||
            JSON.stringify(Object.entries(recorded.parameters).sort()) !== JSON.stringify(Object.entries(request.parameters.parameters).sort())) throw Error("Intervention receipt differs from request");
        }
        if (status === "completed" && outcome?.interventionEnded !== true) throw Error("Intervention completion lacks end evidence");
        break;
      }
      case "load": z.object({ previousTarget: amount, appliedTarget: amount }).parse(outcome); break;
      case "speed": z.object({ previousSpeed: amount, appliedSpeed: amount }).parse(outcome); break;
      case "chaos":
        z.object({ durationSimulatedSeconds: amount }).parse(outcome);
        if (status === "completed") z.object({ faultEnded: z.literal(true), observedOverallHealth: outcomeSchema.shape.observedOverallHealth.unwrap() }).parse(outcome);
        break;
      case "vertical-scale":
        z.object({ fromSkuId: id.nullable(), requestedSkuId: id }).parse(outcome);
        if (status === "completed") z.object({ installedSkuId: id, online: z.literal(true) }).parse(outcome);
        break;
      case "pool-scale":
        // Model 2 changes a replica count; only Model 1 records name the replica.
        z.object({ delta: outcomeSchema.shape.delta.unwrap(), previousReplicaCount: amount, replicaId: id.optional() }).parse(outcome);
        if (status === "completed") z.object({ finalReplicaCount: amount }).parse(outcome);
        break;
      case "topology": z.object({ acceptedRevision: amount, appliedRevision: amount }).parse(outcome); break;
      case "teardown": z.object({ capturedAt: outcomeSchema.shape.capturedAt.unwrap(), appliedRevision: amount }).parse(outcome); break;
    }
  }
  return { id: row.id, deploymentId: row.deploymentId, sequence: row.sequence, ...request, status,
    requestedAt: row.requestedAt.toISOString(), appliedAt: row.appliedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    appliedSimulatedSeconds: row.appliedSimulatedSeconds, completedSimulatedSeconds: row.completedSimulatedSeconds,
    outcome, failureReason: row.failureReason };
}
