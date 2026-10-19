import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSummary, textHash, validateSummary } from "./summary";

export function verifyPinned(path: string) {
  const text = readFileSync(path, "utf8"), summary = JSON.parse(text);
  if (textHash(text) !== readFileSync(`${path}.sha256`, "utf8").trim()) throw Error("Pinned pilot summary changed; regenerate from immutable raw artifacts");
  validateSummary(summary);
  const files = ["app.ts", "worker.ts", "generator.ts", "telemetry.ts", "run.ts", "manifest.json"];
  if (Object.keys(summary.sourceHashes).sort().join() !== [...files].sort().join()) throw Error("Pilot source inventory drift");
  for (const name of files) if (textHash(readFileSync(resolve(import.meta.dir, name), "utf8")) !== summary.sourceHashes[name]) throw Error(`Pilot source drift: ${name}`);
  const producers = ["summary.ts", "verify.ts", "summary.schema.json"];
  if (Object.keys(summary.producerHashes).sort().join() !== [...producers].sort().join()) throw Error("Pilot producer inventory drift");
  for (const name of producers) if (textHash(readFileSync(resolve(import.meta.dir, name), "utf8")) !== summary.producerHashes[name]) throw Error(`Pilot producer drift: ${name}`);
  return summary;
}
if (import.meta.main) {
  const path = resolve(import.meta.dir, "../../../docs/reality/g1-local-pilot.json"), s = verifyPinned(path);
  if (process.argv[2]) {
    const rebuilt = await buildSummary(resolve(process.argv[2])); validateSummary(rebuilt);
    if (JSON.stringify(rebuilt) !== JSON.stringify(s)) throw Error("Raw artifact replay differs from pinned summary");
  }
  console.log(JSON.stringify({ result: "PASS", windows: s.windows.length, artifacts: s.artifacts.length, timingPromotion: s.timingPromotion, rawReplay: Boolean(process.argv[2]) }));
}
