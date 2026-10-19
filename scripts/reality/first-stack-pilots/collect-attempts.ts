import { createReadStream, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createHash } from "node:crypto";

const [destination, ...directories] = process.argv.slice(2);
if (!destination || !directories.length) throw Error("Usage: collect-attempts.ts <new-prior-attempts.json> <closed-capture> ...");
const attempts = [];
for (const directory of directories) {
  const dir = resolve(directory), c = JSON.parse(readFileSync(resolve(dir, "campaign.json"), "utf8"));
  if (!c.endedAt) throw Error("Earlier attempt is still open");
  const artifacts = [];
  for (const name of readdirSync(dir).sort()) {
    const path = resolve(dir, name); if (!statSync(path).isFile()) continue;
    const h = createHash("sha256"); for await (const chunk of createReadStream(path)) h.update(chunk);
    artifacts.push({ name, bytes: statSync(path).size, sha256: h.digest("hex") });
  }
  attempts.push({ directory: basename(dir), startedAt: c.startedAt, endedAt: c.endedAt, failures: c.failures,
    windows: c.windows.map((w: any) => ({ id: w.id, operation: w.operation, rate: w.rate, status: w.status, startedAt: w.startedAt, endedAt: w.endedAt ?? null })), artifacts,
    role: "failed/interrupted setup or discovery; never included in demand or main-window populations" });
}
writeFileSync(resolve(destination), JSON.stringify(attempts, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ priorAttempts: attempts.length }));
