// Test-only bridge: render tests consume actual engine reports, never authored outcomes.
import { answers, attemptRow, definition, REFERENCE } from "./challengeHarness";
import { buildRunReport } from "../reports/report";

const d = definition("split-the-capacity-budget"), app = REFERENCE[`${d.id}-app-headroom`]!, db = REFERENCE[`${d.id}-db-headroom`]!;
const over = {...app, resources: app.resources.map(r => r.id === "db" ? db.resources.find(r => r.id === "db")! : r)};
const predictions = answers(d, {"busiest-type": "Virtual Machine", "overall-health": "healthy"});
console.log(JSON.stringify([REFERENCE[d.id]!, over].map(design => buildRunReport(attemptRow(d, design, predictions)))));
