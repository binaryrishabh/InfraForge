import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { buildRunReport } from "../reports/report";
import { promotionRun } from "./databasePromotion.fixture";

const fast = promotionRun(2, 1, "primary", true).row, slow = promotionRun(2, 60000, "primary", true).row;
const missing = structuredClone(slow), partial = (missing.terminalSnapshot as SimulationSnapshot).metrics.db!.databaseReplication!.rejoin!;
Reflect.deleteProperty(partial, "pendingOperations"); Reflect.deleteProperty(partial, "eligible");
console.log(JSON.stringify([fast, slow, missing].map(row => buildRunReport(row))));
