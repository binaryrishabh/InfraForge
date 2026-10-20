import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { textHash } from "./summary";

const sources = ["g5-run.ts", "g5-probe.ts", "g5-manifest.json", "telemetry.ts", "manifest.json"];
const producers = ["g5-summary.ts"];
function capture(dir: string) {
  const campaign = JSON.parse(readFileSync(resolve(dir, "campaign.json"), "utf8"));
  if (!campaign.endedAt) throw Error("Capture is not closed");
  const artifacts = readdirSync(dir).sort().map(name => {
    const bytes = readFileSync(resolve(dir, name));
    return { name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  const observations = Object.fromEntries(["baseline", "pooler", "smart", "fast"].map(mode => {
    const raw = artifacts.find(a => a.name === `${mode}.jsonl` || a.name === `${mode}.jsonl.gz`);
    if (!raw) return [mode, null];
    const bytes = readFileSync(resolve(dir, raw.name)), text = (raw.name.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString();
    const rows = text.trim().split("\n").map(line => JSON.parse(line));
    const env = rows.find(row => row.kind === "environment")?.environment;
    return [mode, { environment: env ? { bun: env.bun, kernel: env.kernel, cpu: env.cpu, cpuMax: env.cpuMax, memoryMax: env.memoryMax, clock: env.clock } : null,
      events: rows.filter(row => row.id), complete: rows.some(row => row.kind === "end") }];
  }));
  return { campaign, artifacts, observations };
}
export function buildG5(dir: string, prior: string[] = []) {
  const current = capture(dir);
  return { schema: "infraforge-g5-summary/1", scope: "local-semantic-pilot-only", timingPromotion: false, timing: "assumption-only", model2Active: false,
    poolerSupported: false, ...current, priorAttempts: prior.map(path => ({ ...capture(path), use: "retained preliminary capture; shutdown query ended before fast signal; excluded from final parity" })),
    producerHashes: Object.fromEntries(producers.map(name => [name, textHash(readFileSync(resolve(import.meta.dir, name), "utf8"))])),
    unknown: current.campaign.manifest.unknown, caveats: ["No Model 2 timing comparison or calibration", "Finite logical plan only; no SQL protocol, arbitrary SQL or explicit interactive transaction support", "SyncRep intervention observes irreversible commit cancellation, not disk service", "Pooler experiment is separate and unsupported", "No managed entitlement or shutdown-duration forecast"] };
}
export function validateG5(summary: ReturnType<typeof buildG5>) {
  if (summary.schema !== "infraforge-g5-summary/1" || summary.timingPromotion !== false || summary.model2Active !== false || summary.poolerSupported !== false || summary.timing !== "assumption-only") throw Error("Forbidden G5 promotion");
  const { campaign, observations } = summary;
  if (campaign.failures.length || campaign.phases.length !== 4 || campaign.phases.some((p: any) => p.exit !== 0)) throw Error("Incomplete G5 campaign");
  if (Object.values(campaign.manifest.limits).reduce((n: number, l: any) => n + l.cpus, 0) > 3 || Object.values(campaign.manifest.limits).reduce((n: number, l: any) => n + l.memoryMiB, 0) > 5120) throw Error("G5 resource cap");
  for (const name of sources) if (textHash(readFileSync(resolve(import.meta.dir, name), "utf8")) !== campaign.sourceHashes[name]) throw Error(`G5 source drift: ${name}`);
  for (const name of producers) if (textHash(readFileSync(resolve(import.meta.dir, name), "utf8")) !== summary.producerHashes[name]) throw Error(`G5 producer drift: ${name}`);
  const find = (mode: string, id: string) => {
    const rows = observations[mode]; if (!rows?.complete || !rows.environment) throw Error(`Missing G5 phase ${mode}`);
    const matches = rows.events.filter(row => row.id === id);
    if (matches.length !== 1) throw Error(`Missing/duplicate G5 observation ${mode}:${id}`); return matches[0]!;
  };
  const ok = (mode: string, id: string) => { const e = find(mode, id); if (e.outcome !== "completed") throw Error(`G5 expected completion ${id}`); return e; };
  const code = (id: string, expected: string) => { if (find("baseline", id).code !== expected) throw Error(`G5 SQLSTATE ${id}`); };
  const idle = observations.baseline!.events.filter(row => /^idle-\d+$/.test(row.id));
  if (idle.filter(row => row.outcome === "completed").length !== 5 || idle.filter(row => row.code === "53300").length !== 2) throw Error("G5 session ceiling populations");
  if (!ok("baseline", "reserved-monitor").rows.some((r: any) => r.usename === "pilot_app" && r.state === "idle" && r.count === 5)) throw Error("G5 idle session observation");
  ok("baseline", "slot-replacement");
  for (let i = 0; i < 3; i++) {
    code(`statement-timeout-${i}`, "57014"); code(`transaction-timeout-${i}`, "25P04"); code(`lock-timeout-${i}`, "55P03"); code(`cancel-query-${i}`, "57014");
    for (const id of [`post-statement-session-${i}`, `post-cancel-session-${i}`, `lock-released-${i}`, `remote-write-${i}`, `reconcile-${i}`]) ok("baseline", id);
    if (find("baseline", `caller-deadline-${i}`).outcome !== "deadline-exceeded" || ok("baseline", `reconcile-${i}`).rows[0]?.id !== i) throw Error("G5 caller/remote commit reconciliation");
  }
  if (!find("baseline", "commit-wait-observed").waiting || !ok("baseline", "commit-cancel-ack").rows[0]?.acknowledged || ok("baseline", "commit-cancel-reconcile").rows[0]?.id !== 99) throw Error("G5 protected commit intervention");
  if (!find("pooler", "pool-reused-backend").sameBackend || find("pooler", "pool-reused-backend").supported !== false) throw Error("G5 separate transaction pooler");
  const wait = ok("pooler", "pool-waiter"), commit = ok("pooler", "pool-commit");
  if (!(wait.startUs < commit.startUs && wait.atUs >= commit.startUs)) throw Error("G5 pool wait order");
  ok("smart", "shutdown-commit");
  if (find("fast", "shutdown-query").code !== "57P01" || campaign.afterSmart !== campaign.afterFast) throw Error("G5 fast shutdown rollback");
  return { result: "PASS", phases: 4, timeoutRepeats: 3, idleEstablished: 5, idleRefused: 2, lateCommits: 3, protectedCommit: 1, poolerSupported: false, timingPromotion: false };
}
export function verifyG5(path = resolve(import.meta.dir, "../../../docs/reality/g5-local-pilot.json")) {
  const text = readFileSync(path, "utf8"), summary = JSON.parse(text) as ReturnType<typeof buildG5>;
  if (textHash(text) !== readFileSync(`${path}.sha256`, "utf8").trim()) throw Error("G5 summary pin changed");
  return { summary, result: validateG5(summary) };
}
if (import.meta.main) {
  const dest = resolve(import.meta.dir, "../../../docs/reality/g5-local-pilot.json");
  if (process.argv[2] === "--write") {
    const summary = buildG5(resolve(process.argv[3]!), process.argv.slice(4).map(p => resolve(p))); validateG5(summary);
    const text = JSON.stringify(summary, null, 2) + "\n"; writeFileSync(dest, text); writeFileSync(`${dest}.sha256`, textHash(text) + "\n");
  }
  const { summary, result } = verifyG5(dest);
  if (process.argv[2] === "--raw") {
    const rebuilt = buildG5(resolve(process.argv[3]!), process.argv.slice(4).map(p => resolve(p)));
    if (JSON.stringify(summary) !== JSON.stringify(rebuilt)) throw Error("G5 raw replay changed");
  }
  console.log(JSON.stringify(result));
}
