import type { Quantity } from "../../reality/quantity";
import type { ComputeResource } from "../compute/contracts";
import type { DataInput } from "../data/contracts";
export interface ServiceDemand { cpu: Quantity<"cpu-us">; wait: Quantity<"us"> }
export interface CommandConfig { execution: ComputeResource; concurrency: Quantity<"count">; pending: Quantity<"count">; timeout: Quantity<"us">; demands: Record<string, ServiceDemand> }
export interface BrokerConfig extends CommandConfig {
  id: string; kind: "delivery-queue"; profile: "visibility-work-queue/1";
  capacityMessages: Quantity<"count">; capacityBytes: Quantity<"bytes">; lease: Quantity<"us">; retention: Quantity<"us">; maxAttempts: Quantity<"count">;
  dlqMessages: Quantity<"count">; dlqBytes: Quantity<"bytes">; deduplicatePublishes: boolean;
  consumers: Array<{ id: string; credit: Quantity<"count"> }>;
}
export interface ObjectRow { namespace: string; key: string; generation: number; bytes: number; content: string }
export interface ObjectConfig extends CommandConfig { id: string; kind: "object-store"; profile: "atomic-current-object/1"; capacity?: Quantity<"bytes">; initial: Array<Omit<ObjectRow, "bytes"> & { bytes: Quantity<"bytes"> }> }
export interface PublisherConfig { id: string; kind: "async-publisher"; execution: ComputeResource; broker: string; store: string; namespace: string; objectBytes: Quantity<"bytes">; messageBytes: Quantity<"bytes">; delay: Quantity<"us">; publishAttempts: Quantity<"count"> }
export interface WorkerConfig {
  id: string; kind: "async-worker"; execution: ComputeResource; broker: string; store: string; database?: string; databaseOperation: string; databaseKey: string; namespace: string;
  concurrency: Quantity<"count">; prefetch: Quantity<"count">; pollInterval: Quantity<"us">; cpu: Quantity<"cpu-us">; blockingWait: Quantity<"us">; ackDelay: Quantity<"us">; resultBytes: Quantity<"bytes">;
  idempotency: "none" | "object-if-absent"; poisonKeys: string[];
}
export type AsyncResource = BrokerConfig | ObjectConfig | PublisherConfig | WorkerConfig;
export type AsyncIntervention = { id: string; target: string; at: Quantity<"us">; duration: Quantity<"us"> } & ({ kind: "consumer-state"; available: boolean } | { kind: "object-access"; reads: boolean; writes: boolean } | { kind: "object-capacity"; bytes: Quantity<"bytes"> });
export interface AsyncInput extends Omit<DataInput, "workloadVersion" | "resources"> { workloadVersion: "m2f/1"; resources: Array<DataInput["resources"][number] | AsyncResource>; asyncInterventions: AsyncIntervention[] }
export interface MessageBody { key: string; namespace: string; objectKey: string; bytes: number }
export interface QueueRequest { kind: "publish" | "receive" | "ack" | "nack"; logicalId?: string; body?: MessageBody; delayUs?: number; consumer?: string; receipt?: string; action?: "requeue" | "discard" | "dead-letter" }
export interface Delivery { id: string; logicalId: string; publishAttempt: string; attempt: number; consumer: string; receipt: string; deliveredAt: number; leaseUntil: number; body: MessageBody }
export interface QueueReply { ok: boolean; reason?: string; acceptedId?: string; deduplicated?: boolean; delivery?: Delivery; empty?: boolean; durability?: "logical-ownership-only" }
export interface ObjectRequest { kind: "put" | "get" | "head" | "delete"; namespace: string; key: string; bytes?: number; content?: string; ifAbsent?: boolean; ifGeneration?: number }
export interface ObjectReply { ok: boolean; reason?: string; object?: ObjectRow; deleted?: boolean }
