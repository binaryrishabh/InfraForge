import { fileURLToPath } from "node:url";
import { checkBoundaries } from "./boundaries";

const root = fileURLToPath(new URL("../", import.meta.url));
const result = checkBoundaries(root);
if (result.errors.length) {
  for (const error of result.errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`Import boundaries passed: ${result.edges.length} value/type imports, no file or workspace cycles.`);
}
