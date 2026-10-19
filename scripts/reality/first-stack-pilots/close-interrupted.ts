import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Administrative terminal annotation, never a measurement/population repair.
const [dir, reason] = process.argv.slice(2);
if (!dir || !reason) throw Error("Usage: close-interrupted.ts <capture> <reason>; stop only that capture's containers first");
const path = resolve(dir, "campaign.json"), campaign = JSON.parse(readFileSync(path, "utf8"));
if (campaign.endedAt) throw Error("Capture already closed");
campaign.endedAt = new Date().toISOString();
campaign.failures.push({ reason: `Interrupted capture: ${reason}`, missingCells: "Unknown; no scheduled main window is inferred" });
for (const window of campaign.windows) if (window.status === "running") { window.status = "interrupted"; window.endedAt = campaign.endedAt; }
writeFileSync(path, JSON.stringify(campaign, null, 2) + "\n");
