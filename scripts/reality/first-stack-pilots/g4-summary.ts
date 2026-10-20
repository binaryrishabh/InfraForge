import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { textHash } from "./summary";
import { g4Order, g4Sources } from "./g4-run";

const destination = resolve(import.meta.dir, "../../../docs/reality/g4-local-pilot.json");
export function counterDelta(before: any, after: any, key: string): number | null {
  const a = before?.[key], b = after?.[key];
  if (a === null || a === undefined || b === null || b === undefined || !Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return null;
  const delta = Number(b) - Number(a); return delta >= 0 ? delta : null;
}
export function ioDeltas(before: any[] | null, after: any[] | null) {
  if (!before || !after) return null;
  return after.map(b => {
    const a = before.find(a => a.backend_type === b.backend_type && a.object === b.object && a.context === b.context);
    return { backend: b.backend_type, object: b.object, context: b.context,
      ...Object.fromEntries(["reads", "read_bytes", "read_time", "writes", "write_bytes", "write_time", "fsyncs", "fsync_time", "hits", "evictions", "extends", "extend_bytes"].map(k => [k, a?.stats_reset === b.stats_reset ? counterDelta(a, b, k) : null])) };
  });
}
function pgbench(text: string) {
  const value = (pattern: RegExp) => { const match = text.match(pattern); return match ? Number(match[1]) : null; };
  return { completed: value(/number of transactions actually processed: (\d+)/), failed: value(/number of failed transactions: (\d+)/),
    latencyMeanMs: value(/latency average = ([\d.]+) ms/), tps: value(/tps = ([\d.]+)/),
    initialConnectionMs: value(/initial connection time = ([\d.]+) ms/) };
}
export function buildG4(dir: string) {
  const campaign = JSON.parse(readFileSync(resolve(dir, "campaign.json"), "utf8"));
  if (!campaign.endedAt) throw Error("G4 capture must be closed");
  const artifacts = readdirSync(dir).sort().map(name => { const b = readFileSync(resolve(dir, name)); return { name, bytes: b.length, sha256: createHash("sha256").update(b).digest("hex") }; });
  const sampleFile = artifacts.find(a => /^g4-samples.jsonl(\.gz)?$/.test(a.name));
  const samples: any[] = sampleFile ? (() => { const b = readFileSync(resolve(dir, sampleFile.name)); return (sampleFile.name.endsWith(".gz") ? gunzipSync(b) : b).toString().trim().split("\n").filter(Boolean).map(s => JSON.parse(s)); })() : [];
  const windows = campaign.windows.map((w: any) => {
    const a = w.before?.stats, b = w.after?.stats;
    const waits: Record<string, number> = {};
    let sampleCount = 0;
    for (const s of samples.filter(s => s.kind === "sample")) {
      const rows = s.waits.filter((r: any) => r.application_name === `g4-${w.id}`);
      if (rows.length) sampleCount++;
      for (const r of rows) { const k = `${r.state}/${r.wait_event_type ?? "no-wait-event"}/${r.wait_event ?? "no-wait-event"}`; waits[k] = (waits[k] ?? 0) + r.count; }
    }
    const log = artifacts.find(a => a.name === `${w.id}-pgbench.log`);
    return { id: w.id, dataset: w.dataset, operation: w.operation, clients: w.clients, repeat: w.repeat, split: w.clients === 8 ? "holdout" : "exploratory", status: w.status,
      exit: w.exit, containerExit: w.containerExit, actualLimits: w.actualLimits, startedAt: w.startedAt, endedAt: w.endedAt,
      observation: log ? pgbench(readFileSync(resolve(dir, log.name), "utf8")) : null,
      waitSamples: sampleCount ? { sampleCount, backendObservations: waits } : null,
      counterScope: "warmup plus observation plus snapshot overhead; cumulative asynchronous PG counters, not isolated per-query demand",
      databaseDelta: Object.fromEntries(["xact_commit", "xact_rollback", "blks_read", "blks_hit", "blk_read_time", "blk_write_time", "deadlocks", "tup_updated"].map(k => [k, counterDelta(a?.database, b?.database, k)])),
      walDelta: Object.fromEntries(["wal_records", "wal_fpi", "wal_bytes", "wal_buffers_full", "wal_write", "wal_sync", "wal_write_time", "wal_sync_time"].map(k => [k, counterDelta(a?.wal, b?.wal, k)])),
      checkpointerDelta: Object.fromEntries(["num_timed", "num_requested", "num_done", "buffers_written", "write_time", "sync_time"].map(k => [k, counterDelta(a?.checkpointer, b?.checkpointer, k)])),
      ioBefore: a?.io ?? null, ioAfter: b?.io ?? null,
      ioDelta: ioDeltas(a?.io ?? null, b?.io ?? null),
      tableBefore: a?.tables ?? null, tableAfter: b?.tables ?? null,
      cgroupBefore: w.before?.cgroup ?? null, cgroupAfter: w.after?.cgroup ?? null };
  });
  return { schema: "infraforge-g4-summary/1", scope: "local-contract-characterization-only", timingPromotion: false, timing: "assumption-only", model2Active: false, ioImplemented: false,
    campaign: { ...campaign, windows: undefined }, artifacts, windows,
    environment: samples.find(s => s.kind === "environment")?.environment ?? null,
    probeComplete: samples.some(s => s.kind === "end"), probeFailures: samples.filter(s => s.kind === "failure"),
    producerHash: textHash(readFileSync(import.meta.filename, "utf8")),
    unknown: campaign.manifest.unknown,
    caveats: ["Closed-loop clients have no intended open arrivals or app pool; no zero pool wait inferred", "Warmup and observation reconnect once; sessions persist within each phase", "1% sampled transaction logs are not complete root populations; aggregate completed/failed counts are pgbench's", "Sampled waits include warmup and connection transitions; they are backend observations, not durations; no-wait-event is not CPU time", "Buffer misses may hit OS cache; PG read timing is not physical device latency", "PG18 WAL write/fsync counts and timings are in pg_stat_io object=wal; absent older pg_stat_wal fields remain null", "No per-query CPU fit, calibrated timing, saturation, physical durability or whole-stack comparison", "Failures and unrun cells remain retained and Unknown; passing static validation does not mean campaign success"] };
}
export function validateG4(s: ReturnType<typeof buildG4>) {
  if (s.schema !== "infraforge-g4-summary/1" || s.timingPromotion !== false || s.timing !== "assumption-only" || s.model2Active !== false || s.ioImplemented !== false) throw Error("Forbidden G4 promotion");
  const m = s.campaign.manifest;
  if (JSON.stringify(m) !== JSON.stringify(JSON.parse(readFileSync(resolve(import.meta.dir, "g4-manifest.json"), "utf8")))) throw Error("G4 manifest drift");
  if (Object.values(m.limits).reduce((n: number, l: any) => n + l.cpus, 0) > 3 || Object.values(m.limits).reduce((n: number, l: any) => n + l.memoryMiB, 0) > 5120) throw Error("G4 cap");
  if (JSON.stringify(g4Order(m)) !== JSON.stringify(s.campaign.order)) throw Error("G4 design order drift");
  for (const name of g4Sources) if (textHash(readFileSync(resolve(import.meta.dir, name), "utf8")) !== s.campaign.sourceHashes[name]) throw Error(`G4 source drift: ${name}`);
  if (s.producerHash !== textHash(readFileSync(import.meta.filename, "utf8"))) throw Error("G4 producer drift");
  if (!s.campaign.endedAt || new Set(s.windows.map((w: any) => w.id)).size !== s.windows.length) throw Error("G4 closure/duplicate windows");
  for (const w of s.windows) {
    if (!s.campaign.order.some((c: any) => `${c.dataset}-${c.operation}-${c.clients}-${c.repeat}` === w.id)) throw Error("G4 unplanned cell");
    if (w.status === "complete" && (w.exit !== 0 || w.containerExit !== 0 || w.observation?.completed === null || w.observation?.failed === null)) throw Error("G4 missing complete population");
    if (w.split !== (w.clients === 8 ? "holdout" : "exploratory")) throw Error("G4 holdout contaminated");
  }
  const rawComplete = s.windows.every((w: any) => ["warmup.log", "generator-cpu.txt", "generator-memory.txt", "pgbench.log"].every(suffix => s.artifacts.some(a => a.name === `${w.id}-${suffix}`)) && s.artifacts.some(a => a.name.startsWith(`${w.id}-tx.`) && /^\d+$/.test(a.name.slice(`${w.id}-tx.`.length))));
  const success = s.campaign.failures.length === 0 && s.windows.length === s.campaign.order.length && s.windows.every((w: any) => w.status === "complete" && w.observation?.completed > 0 && w.observation?.failed === 0) && s.probeComplete && s.campaign.probeExit === 0 && s.probeFailures.length === 0 && rawComplete;
  if (success) {
    if (!s.environment || s.campaign.datasets.length !== 2) throw Error("G4 missing environment/datasets");
    for (const d of s.campaign.datasets) {
      const fits = d.sizes.totalBytes < d.sizes.sharedBuffersBytes;
      if (fits !== (d.id === "fitting")) throw Error("G4 dataset did not meet declared buffer relation");
    }
    const limitText = (role: string) => { const l = m.limits[role]; return `${l.cpus * 1e9} ${l.memoryMiB * 1048576} ${l.memoryMiB * 1048576} 128`; };
    if (s.campaign.actualLimits.postgres !== limitText("postgres") || s.campaign.actualLimits.probe !== limitText("probe") || s.windows.some((w: any) => w.actualLimits !== limitText("generator"))) throw Error("G4 actual limits differ");
  }
  return { result: "PASS", campaignResult: success ? "complete" : "incomplete-retained", windows: s.windows.length, planned: s.campaign.order.length, failures: s.campaign.failures.length, timingPromotion: false };
}
export function verifyG4(path = destination) {
  const text = readFileSync(path, "utf8"), summary = JSON.parse(text) as ReturnType<typeof buildG4>;
  if (textHash(text) !== readFileSync(`${path}.sha256`, "utf8").trim()) throw Error("G4 summary pin changed");
  return { summary, result: validateG4(summary) };
}
if (import.meta.main) {
  if (process.argv[2] === "--write") {
    const s = buildG4(resolve(process.argv[3]!)); validateG4(s);
    const text = JSON.stringify(s, null, 2) + "\n"; writeFileSync(destination, text); writeFileSync(`${destination}.sha256`, textHash(text) + "\n");
  }
  const { summary, result } = verifyG4();
  if (process.argv[2] === "--raw" && JSON.stringify(summary) !== JSON.stringify(buildG4(resolve(process.argv[3]!)))) throw Error("G4 raw replay changed");
  console.log(JSON.stringify(result));
}
