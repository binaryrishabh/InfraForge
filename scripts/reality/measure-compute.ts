import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
const counts = [1, 2, 4, 8, 16, 32].filter((n) => n <= Math.min(32, availableParallelism() * 2));
const cpu = [], memory = [];
for (const workers of counts) {
  cpu.push(JSON.parse(execFileSync("node", [new URL("./compute-benchmark.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), JSON.stringify({ mode: "cpu", workers })], { encoding: "utf8", timeout: 180000, maxBuffer: 16777216 })));
  console.log(`Measured CPU: ${workers} workers`);
}
for (const workers of counts.filter((n) => n <= 4)) {
  memory.push(JSON.parse(execFileSync("node", ["--expose-gc", new URL("./compute-benchmark.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), JSON.stringify({ mode: "memory", workers })], { encoding: "utf8", timeout: 60000, maxBuffer: 16777216 })));
  console.log(`Measured memory ownership/RSS: ${workers} workers`);
}
writeFileSync(new URL("../../docs/reality/m2c-measurements.json", import.meta.url), JSON.stringify({ cpu, memory }, null, 2) + "\n");
