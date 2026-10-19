import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSummary, textHash, validateSummary } from "./summary";

export function verifyPinned(path: string) {
  const text = readFileSync(path, "utf8"), summary = JSON.parse(text);
  if (textHash(text) !== readFileSync(`${path}.sha256`, "utf8").trim()) throw Error("Pinned pilot summary changed; regenerate from immutable raw artifacts");
  validateSummary(summary); return summary;
}
if (import.meta.main) {
  const path = resolve(import.meta.dir, "../../../docs/reality/g1-local-pilot.json"), s = verifyPinned(path);
  if (process.argv[2]) {
    const rebuilt = await buildSummary(resolve(process.argv[2])); validateSummary(rebuilt);
    if (JSON.stringify(rebuilt) !== JSON.stringify(s)) throw Error("Raw artifact replay differs from pinned summary");
  }
  console.log(JSON.stringify({ result: "PASS", windows: s.windows.length, artifacts: s.artifacts.length, timingPromotion: s.timingPromotion, rawReplay: Boolean(process.argv[2]) }));
}
