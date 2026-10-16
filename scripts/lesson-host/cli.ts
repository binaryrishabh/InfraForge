import { writeFile } from "node:fs/promises";
import { collect } from "./collect";
import { evaluate } from "./policy";
import { provenance } from "./identity";
const [image, revision, output] = process.argv.slice(2);
if (process.argv.length !== 5 || !/^sha256:[a-f0-9]{64}$/.test(image ?? "") || !/^[a-f0-9]{40}$/.test(revision ?? "") || !output) throw Error("Usage: bun --no-env-file scripts/lesson-host/cli.ts sha256:IMAGE APPROVED_SHA NEW_OUTPUT.json");
const report = { ...evaluate(await collect(image!), image!, revision!), provenance: provenance() };
await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.info(JSON.stringify({ output, eligibleForProbes: report.eligibleForProbes, rootlessReady: false }));
// Exit 0 means preflight only. No outcome from this command authorizes preview.
process.exitCode = report.eligibleForProbes ? 0 : 1;
