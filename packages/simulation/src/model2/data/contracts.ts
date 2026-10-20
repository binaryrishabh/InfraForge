import type { Quantity } from "../../reality/quantity";
import type { ComputeResource } from "../compute/contracts";
import type { NetworkInput } from "../network/contracts";

export interface Row { key: string; version: number; bytes: Quantity<"bytes"> }
export interface Statement {
  kind: "snapshot-read" | "write" | "insert" | "lock-read";
  keys: string[]; cpu: Quantity<"cpu-us">; parallelism: Quantity<"cores">; blockingWait: Quantity<"us">;
  logBytes: Quantity<"bytes">; insertBytes?: Quantity<"bytes">;
}
export interface TransactionPlan { statements: Statement[]; statementTimeout: Quantity<"us">; lockTimeout: Quantity<"us">; transactionTimeout: Quantity<"us">; commitWait: Quantity<"us">; durability: "logical-only" | "authored-log-ack" }
export interface RelationalConfig {
  id: string; kind: "relational"; semantics: "read-committed-keyed/1" | "postgresql-keyed/1";
  execution: ComputeResource; maxSessions: Quantity<"count">; activeTransactions: Quantity<"count">; pendingQueries: Quantity<"count">;
  keys: string[]; initial: Row[]; plans: Record<string, TransactionPlan>;
}
export interface CacheConfig {
  id: string; kind: "cache"; semantics: "keyed-cache/1"; execution: ComputeResource;
  capacity: Quantity<"bytes">; entryOverhead: Quantity<"bytes">; policy: "lru" | "no-eviction";
  ttl: Quantity<"us">; initial: Row[]; commandCpu: Quantity<"cpu-us">;
}
export interface AsideConfig {
  id: string; kind: "cache-aside"; execution: ComputeResource; cache: string; database: string;
  keys: string[]; access: "cycle" | "keyed-uniform"; coalesce: boolean; onCacheFailure: "fail" | "database";
  invalidateWrites: boolean; operations: Record<string, "read" | "write">;
}
export type DataResource = RelationalConfig | CacheConfig | AsideConfig;
export type DataIntervention = { id: string; at: Quantity<"us"> } & (
  { kind: "flush"; target: string } | { kind: "session-capacity"; target: string; sessions: Quantity<"count">; duration: Quantity<"us"> } | { kind: "cpu-capacity"; target: string; cores: Quantity<"cores">; duration: Quantity<"us"> });
export interface DataInput extends Omit<NetworkInput, "workloadVersion" | "resources"> {
  workloadVersion: "m2e/1" | "m2e-pg/1";
  resources: Array<NetworkInput["resources"][number] | DataResource>;
  dataInterventions: DataIntervention[];
}
export interface DataRequest { kind: "get" | "set" | "invalidate" | "query"; key: string; row?: { version: number; bytes: number }; token?: string }
export interface DataReply { ok: boolean; hit?: boolean; key?: string; version?: number; bytes?: number; token?: string; rows?: Array<{ key: string; version: number; bytes: number }>; reason?: string; durable?: boolean }
