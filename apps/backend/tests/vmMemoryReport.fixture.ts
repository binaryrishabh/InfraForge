// Real engine reports shared with the web render test; mutations exercise stored-data refusal paths.
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { buildRunReport } from "../reports/report";
import { answers, attemptRow, definition, REFERENCE } from "./challengeHarness";

const d = definition("fit-a-request-in-memory");
const medium = structuredClone(d.starter!); medium.resources.find(r => r.id === "app")!.size = "medium";
const rows = [d.starter!, medium, REFERENCE[d.id]!, REFERENCE[`${d.id}-request`]!]
  .map(design => attemptRow(d, design, answers(d, {"database-health": "healthy"})));
const base = rows[1]!;
const raw = (row: typeof base) => row.terminalSnapshot as SimulationSnapshot;
const reading = (row: typeof base) => raw(row).metrics.app!.vmMemory!.resources[0]!;
const variant = (mutate: (row: typeof base) => void) => { const row = structuredClone(base); mutate(row); return buildRunReport(row); };
console.log(JSON.stringify({
  reports: rows.map(row => buildRunReport(row)),
  missing: variant(row => { delete raw(row).metrics.app!.vmMemory; }),
  unknown: variant(row => { Object.assign(reading(row), {residentBytes: null, headroomBytes: null, comparison: "unknown"}); }),
  invalid: variant(row => { reading(row).allocationRejected = -1; }),
  checkpointOnly: variant(row => { row.simulationState = structuredClone(row.terminalSnapshot); row.terminalSnapshot = null; }),
  noSnapshot: variant(row => { row.terminalSnapshot = null; row.simulationState = null; }),
}));
