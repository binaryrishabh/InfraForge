export interface StoredObject {
  namespace: string;
  key: string;
  generation: number;
  bytes: number;
}
export interface TransferContext {
  path: string;
  direction: "request" | "response";
  hop: number;
  origin: string;
  destination: string;
  callId: string;
  rootId: string;
  attempt: number;
}
export type UsageDetail =
  | { kind: "object-origin"; objects: StoredObject[] }
  | { kind: "object-mutation"; request: number; command: "put" | "delete"; before: StoredObject | null; after: StoredObject | null }
  | { kind: "operation-start"; request: number; admitted: boolean; command: string | null; callId: string; rootId: string; attempt: number }
  | { kind: "operation-end"; request: number; outcome: "completed" | "failed" | "rejected" | "cancelled"; reason: string | null }
  | { kind: "transfer-start"; transfer: number; id: string; bytes: number; accepted: boolean; context: TransferContext | null }
  | { kind: "transfer-end"; transfer: number; outcome: "delivered" | "unreachable" | "overflow" | "aborted" };
export type UsageSource = {
  family: "object-store";
  resource: string;
  profile: string;
} | {
  family: "link";
  resource: string;
  profile: string;
  from: string;
  to: string;
};
export interface UsageRecord {
  source: string;
  sequence: number;
  atUs: number;
  detail: UsageDetail;
}
export interface RuntimeUsageObserver {
  select(family: UsageSource["family"], resource: string): boolean;
  attach(source: UsageSource, head: () => number): (record: UsageRecord) => void;
}
export type UsageEmitter = (detail: UsageDetail) => void;
export interface MeteringConfig {
  schema: "infraforge-usage-metering/1";
  run: string;
  epoch: string;
  inputFingerprint: string;
  provenance: string[];
  objects: string[];
  links: string[];
  maxRecords: number;
  maxFields: number;
  maxTextCharacters: number;
}
