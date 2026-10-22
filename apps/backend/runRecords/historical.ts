import type { RunRecord } from "@infraforge/contracts/reports";
import type { StoredRun } from "../reports/report";
import type { InternalRunRow } from "../internalModel2/store";
import type { FirstStackStoredReportRow } from "../firstStack/report";
import { model1RunRecord, model2RunRecord } from "./adapters";
import { firstStackRunRecord } from "./firstStack";
import { historicalExecutionPolicy, type HistoricalExecutionPolicy } from "./availability";

export type HistoricalRun = { store: "Deployment"; row: StoredRun } |
  { store: "InternalModel2Run"; row: InternalRunRow; lessonProfile?: string } |
  { store: "FirstStackRun"; row: FirstStackStoredReportRow };
// Dispatch by recorded store and nested schema, never by the active engine.
// Every adapter reads stored data only; unavailable parts have explicit reasons.
export function historicalRunRecord(value: HistoricalRun, policy: HistoricalExecutionPolicy = historicalExecutionPolicy): RunRecord {
  switch (value.store) {
    case "Deployment": return model1RunRecord(value.row, policy);
    case "InternalModel2Run": return model2RunRecord(value.row, value.lessonProfile);
    case "FirstStackRun": return firstStackRunRecord(value.row);
    default: throw Error("Unsupported historical run store; no reinterpretation");
  }
}
