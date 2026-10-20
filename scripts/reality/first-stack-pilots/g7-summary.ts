import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { textHash } from "./summary";

const sources = ["g7-run.ts", "g7-probe.ts", "g7-manifest.json", "G7.Dockerfile", "telemetry.ts"];
const pins = () => Object.fromEntries(["g7-summary.ts"].map(p => [p, textHash(readFileSync(resolve(import.meta.dir, p), "utf8"))]));
export function buildG7(dir: string) {
  const campaign = JSON.parse(readFileSync(resolve(dir, "campaign.json"), "utf8"));
  const artifacts = readdirSync(dir).sort().map(name => { const b = readFileSync(resolve(dir, name)); return { name, bytes: b.length, sha256: createHash("sha256").update(b).digest("hex") }; });
  const raw = artifacts.find(a => a.name === "g7.jsonl.gz" || a.name === "g7.jsonl"); if (!raw) throw Error("Missing G7 raw log");
  const bytes = readFileSync(resolve(dir, raw.name));
  const rows = (raw.name.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString().trim().split("\n").map(s => JSON.parse(s));
  const windows = rows.filter(r => r.kind === "window-start").map(start => {
    const lookups = rows.filter(r => r.kind === "lookup" && r.id === start.id), end = rows.find(r => r.kind === "window-end" && r.id === start.id);
    const dictionary = [...new Set<string>(lookups.map(r => r.key))].sort(), index = new Map(dictionary.map((key, i) => [key, i]));
    return { id: start.id, repeat: start.repeat ?? null, policy: start.policy, size: start.size, warm: start.warm, holdout: !!start.holdout,
      dictionary, recordedKeys: lookups.map(r => index.get(r.key)!), hits: lookups.map(r => r.hit ? "1" : "0").join(""),
      fills: lookups.map(r => !r.fill ? "-" : r.fill.acknowledged ? "A" : "R").join(""),
      backingCalls: lookups.reduce((s, r) => s + r.backingCalls, 0), rejectedReasons: [...new Set<string>(lookups.filter(r => r.fill && !r.fill.acknowledged).map(r => r.fill.reason))],
      before: start.before, after: end?.after ?? null, victims: end?.victims ?? null,
      telemetry: { before: start.telemetry ?? null, after: end?.telemetry ?? null },
      commandCpuCoreUs: null, fullPhysicalDbWorkSaved: null,
      traceHash: textHash(JSON.stringify(lookups.map(r => ({ key: r.key, hit: r.hit, fill: r.fill, backingCalls: r.backingCalls })))) };
  });
  const env = rows.find(r => r.kind === "environment");
  return { schema: "infraforge-g7-summary/1", timing: "assumption-only", timingPromotion: false, model2Active: false,
    scope: "finite local observations; no fit or managed timing claim", campaign, artifacts,
    environment: env?.environment ?? null, backing: env?.backing ?? null, server: rows.find(r => r.kind === "server") ?? null,
    windows, ttl: rows.filter(r => r.kind === "ttl"), stampedes: rows.filter(r => r.kind === "stampede"),
    stampedeFills: rows.filter(r => r.kind === "stampede-fill"), invalidations: rows.filter(r => r.kind === "invalidation"),
    complete: rows.some(r => r.kind === "end"), failures: rows.filter(r => r.kind === "failure"),
    producerHashes: pins(), unknown: campaign.manifest.unknown,
    caveats: ["Sampled Valkey LRU victim sets and hit statistics are observations; exact-LRU order equality is not claimed",
      "INFO commandstats elapsed microseconds are not per-command CPU core-time; process CPU remains separate",
      "Backing calls are real in-process map/function calls, not PostgreSQL measurements or DB timing",
      "Warm above-cap inventory is loaded before applying the cap; policy action is observed after the cap",
      "Writes use a single-app generation guard; distributed invalidation coherence remains unsupported"] };
}
export function validateG7(s: ReturnType<typeof buildG7>) {
  if (s.schema !== "infraforge-g7-summary/1" || s.timing !== "assumption-only" || s.timingPromotion !== false || s.model2Active !== false) throw Error("Forbidden G7 promotion");
  if (!s.complete || !s.environment || !s.server || s.failures.length || !s.campaign.endedAt || s.campaign.exit !== 0 || s.campaign.oomKilled !== "false" || s.campaign.failures.length) throw Error("Incomplete G7 campaign");
  const manifest = JSON.parse(readFileSync(resolve(import.meta.dir, "g7-manifest.json"), "utf8"));
  if (JSON.stringify(s.campaign.manifest) !== JSON.stringify(manifest) || manifest.limits.cpus > 3 || manifest.limits.memoryMiB > 5120 || manifest.limits.containers !== 1) throw Error("G7 manifest/resource drift");
  for (const p of sources) if (textHash(readFileSync(resolve(import.meta.dir, p), "utf8")) !== s.campaign.sourceHashes[p]) throw Error(`G7 source drift: ${p}`);
  if (JSON.stringify(s.producerHashes) !== JSON.stringify(pins())) throw Error("G7 producer drift");
  const expected = [];
  for (let repeat = 0; repeat < manifest.repeats; repeat++) for (const policy of manifest.policies) for (const size of manifest.workingSets) for (const warm of [false, true]) expected.push(`${repeat}:${policy}:${size}:${warm ? "warm" : "cold"}`);
  expected.push("holdout-square-modulo");
  if (JSON.stringify(s.windows.map(w => w.id)) !== JSON.stringify(expected)) throw Error("G7 missing/duplicate window");
  let hits = 0, misses = 0, fills = 0, refused = 0;
  for (const w of s.windows) {
    const n = w.recordedKeys.length;
    if (!w.after || w.hits.length !== n || w.fills.length !== n || w.recordedKeys.some(i => !Number.isSafeInteger(i) || !w.dictionary[i]) || !/^[01]+$/.test(w.hits) || !/^[-AR]+$/.test(w.fills)) throw Error("G7 recorded-key populations");
    if (n !== (w.holdout ? manifest.holdout.rows : w.size * 2)) throw Error("G7 lost trace row");
    const h = [...w.hits].filter(c => c === "1").length, m = n - h, a = [...w.fills].filter(c => c === "A").length, r = [...w.fills].filter(c => c === "R").length;
    if (w.backingCalls !== m || a + r !== m || [...w.hits].some((c, i) => c === "1" ? w.fills[i] !== "-" : w.fills[i] === "-")) throw Error("G7 backing/fill conservation");
    for (let i = 0; i < n; i++) {
      const key = w.dictionary[w.recordedKeys[i]!]!, ordinal = w.holdout ? (i * i) % manifest.holdout.workingSet : i % w.size;
      if (key !== `key:${ordinal}`) throw Error("G7 changed recorded trace");
    }
    for (const [field, expected] of [["keyspace_hits", h], ["keyspace_misses", m]] as const) if (Number(w.after[field]) - Number(w.before[field]) !== expected) throw Error(`G7 INFO mismatch ${field}`);
    if (!w.holdout && w.policy === "allkeys-lru" && w.size === 2048 && Number(w.after.evicted_keys) <= Number(w.before.evicted_keys)) throw Error("Missing sampled eviction observation");
    if (w.policy === "noeviction" && w.size === 2048 && !w.warm && r === 0) throw Error("Missing actual OOM SET refusal");
    if (w.commandCpuCoreUs !== null || w.fullPhysicalDbWorkSaved !== null) throw Error("G7 Unknown became zero");
    hits += h; misses += m; fills += a; refused += r;
  }
  if (s.ttl.length !== 1 || !s.ttl[0].initialHit || !s.ttl[0].expiredMiss || !(s.ttl[0].observedPttlMs > 0) || Number(s.ttl[0].after.expired_keys) <= Number(s.ttl[0].before.expired_keys)) throw Error("Missing observed TTL expiry");
  if (s.stampedes.length !== 2 || s.stampedes.some((r, i) => r.coalesce !== !!i || r.roots.length !== 3 || r.roots.some((root: any) => root.hit || root.key !== "stampede-key") || r.backingCalls !== (r.coalesce ? 1 : 3))) throw Error("G7 stampede conservation");
  if (s.stampedeFills.length !== 4 || s.stampedeFills.some(r => !r.fill.acknowledged)) throw Error("G7 stampede fill acknowledgement");
  if (s.invalidations.length !== 1 || !s.invalidations[0].staleFillRefused || s.invalidations[0].afterInvalidation !== null || s.invalidations[0].currentVersion !== 2) throw Error("G7 write/invalidation reconciliation");
  return { result: "PASS", windows: s.windows.length, hits, misses, fills, refused, stampedeBacking: [3, 1], timingPromotion: false };
}
export function verifyG7(path = resolve(import.meta.dir, "../../../docs/reality/g7-local-pilot.json")) {
  const text = readFileSync(path, "utf8"), summary = JSON.parse(text) as ReturnType<typeof buildG7>;
  if (textHash(text) !== readFileSync(`${path}.sha256`, "utf8").trim()) throw Error("G7 summary pin drift");
  return { summary, result: validateG7(summary) };
}
if (import.meta.main) {
  const dest = resolve(import.meta.dir, "../../../docs/reality/g7-local-pilot.json");
  if (process.argv[2] === "--write") {
    const summary = buildG7(resolve(process.argv[3]!)); validateG7(summary);
    const text = JSON.stringify(summary, null, 2) + "\n"; writeFileSync(dest, text); writeFileSync(`${dest}.sha256`, textHash(text) + "\n");
  }
  const { summary, result } = verifyG7(dest);
  if (process.argv[2] === "--raw" && JSON.stringify(buildG7(resolve(process.argv[3]!))) !== JSON.stringify(summary)) throw Error("G7 raw replay drift");
  console.log(JSON.stringify(result));
}
