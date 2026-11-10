import { z } from "zod";
import { DatabaseRejoinMetricsSchema } from "./databaseRejoinSchema";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const amount = z.number().finite().nonnegative();
const member = z.object({
  admitted: count, committed: count, aborted: count, cancelled: count,
  sessionRefused: count, queryRefused: count, peakSessions: count, peakActive: count, peakQueued: count,
  sessions: count, active: count, queued: count, sessionLimit: count, activeLimit: count, queueLimit: count, consumedCoreUs: amount,
}).strict();
export const DatabaseMetricsSchema = z.object({
  version: z.literal(1), serving: count.nullable(), waiting: count.nullable(), queued: count.nullable(),
  rejected: count.nullable(), sessionRefused: count.nullable(), "query-queue-full": count.nullable(),
  readRouting: z.object({version: z.literal(1), policy: z.enum(["primary-only", "replica-preferred"]),
    fallback: z.literal("unavailable-only; capacity refuses"), sessionModel: z.string().min(1).max(400),
    staleReads: count, maxStaleReadAgeMs: amount, unboundSessions: count,
    members: z.object({primary: member, replica: member}).strict(),
  }).strict().optional(),
}).strict();
export const DatabaseReplicationMetricsSchema = z.object({
  version: z.literal(1), currentWriter: z.enum(["primary", "replica", "none"]).nullable(),
  primaryProcessState: z.enum(["available", "unavailable", "fenced", "replica"]).nullable().optional(),
  replicaProcessState: z.enum(["available", "unavailable", "writer"]).nullable().optional(),
  sessionInvalidations: count.nullable().optional(), connectionInvalidations: count.nullable().optional(),
  failedWritesWithoutWriter: count.nullable().optional(), regressedKeyCount: count.nullable().optional(),
  replicaState: z.enum(["available", "unavailable", "promoted"]).nullable(),
  writerEpoch: count.nullable(), primaryEpoch: count.nullable(), replicaEpoch: count.nullable(),
  primaryRole: z.enum(["writer", "fenced", "replica"]).nullable(), replicaRole: z.enum(["replica", "writer"]).nullable(),
  fencedWriteRejections: count.nullable(), fencedReplicationRejections: count.nullable(), replicaCommittedWrites: count.nullable(),
  promotionCount: count.nullable(), promotionAtUs: amount.nullable(), lostOperations: count.nullable(),
  regressedKeys: z.array(z.object({key: z.string().min(1).max(256), primaryVersion: count, promotedVersion: count}).strict()).max(8).nullable(),
  primaryReads: count.nullable(), replicaReads: count.nullable(), freshReplicaReads: count.nullable(), staleReplicaReads: count.nullable(),
  primaryCommittedWrites: count.nullable(), replicaAppliedWrites: count.nullable(), pendingReplication: count.nullable(),
  lagMs: amount.nullable(), oldestPendingAgeMs: amount.nullable(), primaryGeneration: count.nullable(), replicaGeneration: count.nullable(),
  rejoin: DatabaseRejoinMetricsSchema.nullable().optional(),
}).strict();
