import type { MeteringConfig, StoredObject, UsageRecord, UsageSource } from "./contracts";

export type OperationCounts = Record<"received" | "completed" | "failed" | "rejected" | "cancelled" | "live" | "admitted", string>;
export interface ObjectMeasurement {
  family: "object-store";
  resource: string;
  storedBytes: string;
  byteUs: string;
  generation: number;
  objects: StoredObject[];
  committedPuts: string;
  replacedObjects: string;
  removedObjects: string;
  createdBytes: string;
  releasedBytes: string;
  operations: OperationCounts;
  commands: Array<{ command: string | null; counts: OperationCounts }>;
}
export type TransferCounts = Record<"offeredBytes" | "acceptedBytes" | "rejectedBytes" | "deliveredBytes" | "failedBytes" | "liveBytes" | "offeredTransfers" | "terminalTransfers" | "liveTransfers", string>;
export interface LinkMeasurement {
  family: "link";
  resource: string;
  from: string;
  to: string;
  totals: TransferCounts;
  directions: Record<"request" | "response" | "unattributed", TransferCounts>;
  providerBillableTransfer: "Unknown";
}
export type SourceMeasurement = ObjectMeasurement | LinkMeasurement;
export interface UsageSnapshot {
  schema: "infraforge-usage-snapshot/1";
  config: MeteringConfig;
  atUs: number;
  complete: boolean;
  reasons: string[];
  omittedRecords: number;
  sources: Array<{ id: string; descriptor: UsageSource; producerHead: number; collectedHead: number }>;
  measurements: SourceMeasurement[];
  fingerprint: string;
}
export interface UsageFrame {
  schema: "infraforge-usage-frame/1";
  config: MeteringConfig;
  snapshot: UsageSnapshot;
  records: UsageRecord[];
  retained: { records: number; fields: number; textCharacters: number };
  fingerprint: string;
}
