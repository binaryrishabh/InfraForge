import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkBoundaries } from "./boundaries";

const root = fileURLToPath(new URL("../", import.meta.url));
const legacy = JSON.parse(readFileSync(new URL("./legacy-shared-imports.json", import.meta.url), "utf8"));
const browserClosure = JSON.parse(readFileSync(new URL("./legacy-browser-closure.json", import.meta.url), "utf8"));
const legacyPackages = JSON.parse(readFileSync(new URL("./legacy-shared-packages.json", import.meta.url), "utf8"));
const result = checkBoundaries(root, legacy, browserClosure, legacyPackages);
if (result.errors.length) {
  for (const error of result.errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`Import boundaries passed: ${result.edges.length} value/type imports, no file or workspace cycles.`);
}
