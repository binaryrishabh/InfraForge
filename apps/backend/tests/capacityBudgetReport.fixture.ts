// Test-only bridge: render tests consume actual engine reports, never authored outcomes.
import { answers, attemptRow, definition, REFERENCE } from "./challengeHarness";
import { buildRunReport } from "../reports/report";

const d = definition("split-the-capacity-budget"), app = REFERENCE[`${d.id}-app-headroom`]!, db = REFERENCE[`${d.id}-db-headroom`]!;
const over = {...app, resources: app.resources.map(r => r.id === "db" ? db.resources.find(r => r.id === "db")! : r)};
const predictions = answers(d, {"busiest-type": "Virtual Machine", "overall-health": "healthy"});
const rows = [REFERENCE[d.id]!, over].map(design => attemptRow(d, design, predictions));
const base = rows[0]!;
type Stage = {name: string; status: string; details: {monthlyEstimate?: unknown; lineItems?: unknown}};
const variant = (mutate: (row: typeof base) => void) => { const row = structuredClone(base); mutate(row); return buildRunReport(row); };
const stage = (row: typeof base) => (row.stages as Stage[]).find(s => s.name === "CostEstimate")!;
console.log(JSON.stringify({
  reports: rows.map(row => buildRunReport(row)),
  storedItems: stage(base).details.lineItems,
  missingCost: variant(row => { row.stages = (row.stages as Stage[]).filter(s => s.name !== "CostEstimate"); }),
  legacy: variant(row => { delete stage(row).details.lineItems; }),
  invalidItems: [null, [], [{resourceId: "app", type: "Virtual Machine", monthlyUsd: -1}],
    [{resourceId: "app", type: "Virtual Machine", monthlyUsd: 108}, {resourceId: "app", type: "Database", monthlyUsd: 0}]]
    .map(items => variant(row => { stage(row).details.lineItems = items; })),
  failedCost: variant(row => { stage(row).status = "failed"; }),
  duplicateCost: variant(row => { (row.stages as Stage[]).push(structuredClone(stage(row))); }),
  wrongIdentity: variant(row => { row.challengeSpecHash = "0".repeat(64); }),
  noBudget: variant(row => { row.challengeId = null; }),
}));
