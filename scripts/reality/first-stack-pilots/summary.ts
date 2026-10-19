import { createReadStream, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { createHash } from "node:crypto";

type Row = Record<string, any>;
export const textHash = (text: string) => createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");
export function distribution(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), round = (v: number) => Math.round(v * 1000) / 1000;
  return { count: sorted.length, mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length), min: round(sorted[0]!),
    p50: round(sorted[Math.ceil(sorted.length * .5) - 1]!), p95: round(sorted[Math.ceil(sorted.length * .95) - 1]!),
    p99: round(sorted[Math.ceil(sorted.length * .99) - 1]!), max: round(sorted.at(-1)!) };
}
async function* rows(path: string): AsyncGenerator<Row> {
  const stream = createReadStream(path), input = path.endsWith(".gz") ? stream.pipe(createGunzip()) : stream;
  for await (const line of createInterface({ input, crlfDelay: Infinity })) if (line) yield JSON.parse(line);
}
function capture(dir: string, name: string) { const names = readdirSync(dir); return resolve(dir, names.includes(name) ? name : `${name}.gz`); }
function counters(sample: Row | undefined) {
  return { cpu: sample?.cpu ?? null, memory: sample?.memory ?? null, fdCount: sample?.fdCount ?? null,
    cpuStat: sample?.cpuStat ?? null, cpuPressure: sample?.cpuPressure ?? null, memoryEvents: sample?.memoryEvents ?? null,
    ioStat: sample?.ioStat ?? null, ioPressure: sample?.ioPressure ?? null, sockets: sample?.sockets ?? null };
}
export function population(client: Row[], server: Map<string, Row>, observeS: number) {
  const outcomes: Record<string, number> = {}, latency: number[] = [], lag: number[] = [], queue: number[] = [], pool: number[] = [], cpu: number[] = [], service: number[] = [];
  let sent = 0, serverSeen = 0, serverAfterDeadline = 0, good = 0, serverRejected = 0, serverCompleted = 0;
  const ids = new Set<string>();
  for (const r of client) {
    if (ids.has(r.id)) throw Error(`Duplicate generator root ${r.id}`); ids.add(r.id);
    outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
    if (r.actualSendUs !== null) { sent++; lag.push(r.actualSendUs - r.intendedUs); }
    if (r.outcome === "completed") { latency.push(r.responseUs - r.intendedUs); if (r.responseUs <= r.deadlineUs) good++; }
    const s = server.get(r.id);
    if (!s) continue;
    serverSeen++; if (s.serverAfterDeadline) serverAfterDeadline++; if (s.outcome === "rejected") serverRejected++;
    if (s.outcome === "completed") serverCompleted++;
    if (typeof s.dispatchUs === "number") queue.push(s.dispatchUs - s.receivedUs);
    if (typeof s.poolWaitUs === "number") pool.push(s.poolWaitUs);
    if (typeof s.threadCpuUs === "number") cpu.push(s.threadCpuUs);
    if (typeof s.dispatchUs === "number" && s.outcome === "completed") service.push(s.completedUs - s.dispatchUs);
  }
  return { offered: client.length, sent, outcomes, serverSeen, sentWithoutServer: sent - serverSeen, serverRejected, serverCompleted, serverAfterDeadline,
    cohortCompletedPerSecond: (outcomes.completed ?? 0) / observeS, cohortGoodputPerSecond: good / observeS,
    completedLatencyFromIntendedUs: distribution(latency), generatorLagUs: distribution(lag), workerQueueUs: distribution(queue),
    poolWaitUs: distribution(pool), threadCpuUs: distribution(cpu), dispatchToCompleteUs: distribution(service) };
}
export async function buildSummary(dir: string) {
  const campaign: Row = JSON.parse(readFileSync(resolve(dir, "campaign.json"), "utf8"));
  if (!campaign.endedAt) throw Error("Capture still running; refusing mutable evidence");
  const server = new Map<string, Row>(), samples: Row[] = [], startupErrors: Row[] = [];
  for await (const r of rows(capture(dir, "app.jsonl"))) {
    if (r.kind === "root") { if (server.has(r.id)) throw Error(`Duplicate server root ${r.id}`); server.set(r.id, r); }
    else if (r.kind === "sample") samples.push(r); else startupErrors.push(r);
  }
  const windows: Row[] = [], candidateCpu: number[] = [], candidateIds = new Set<string>(), allClientIds = new Map<string, Row>();
  for (const w of campaign.windows) {
    const observed: Row[] = [], warmup: Row[] = [], generatorSamples: Row[] = []; let end: Row | undefined;
    for await (const r of rows(capture(dir, `${w.id}.jsonl`))) {
      if (r.kind === "root") { if (allClientIds.has(r.id)) throw Error("Cross-window duplicate root"); allClientIds.set(r.id, { outcome: r.outcome }); (r.phase === "observed" ? observed : warmup).push(r); }
      else if (r.kind === "sample") generatorSamples.push(r); else if (r.kind === "end") end = r;
    }
    const total = observed.length + warmup.length;
    if (w.status === "complete" && (total !== Math.ceil((w.warmupS + w.observeS) * w.rate) || !end || end.offered !== total)) throw Error(`Missing offered population in ${w.id}`);
    const env = JSON.parse(readFileSync(resolve(dir, `${w.id}-environment.json`), "utf8"));
    windows.push({ id: w.id, operation: w.operation, rate: w.rate, split: w.split, label: w.label, status: w.status, startedAt: w.startedAt, endedAt: w.endedAt,
      warmupS: w.warmupS, observeS: w.observeS, observed: population(observed, server, w.observeS), warmup: population(warmup, server, w.warmupS),
      generator: { cpuMax: env.cpuMax, memoryMax: env.memoryMax, first: counters(generatorSamples[0]), last: counters(end ?? generatorSamples.at(-1)),
        maxRss: generatorSamples.length ? Math.max(...generatorSamples.map((s) => s.memory.rss)) : null }, stderr: w.stderr });
    if (w.operation === "cpu" && w.split === "exploratory") for (const r of observed) {
      const s = server.get(r.id);
      if (r.outcome === "completed" && s?.outcome === "completed" && typeof s.threadCpuUs === "number") { candidateCpu.push(s.threadCpuUs); candidateIds.add(r.id); }
    }
  }
  const artifacts = [];
  for (const name of readdirSync(dir).sort()) {
    const path = resolve(dir, name); if (!statSync(path).isFile()) continue;
    const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk);
    artifacts.push({ name, bytes: statSync(path).size, sha256: hash.digest("hex") });
  }
  const env = JSON.parse(readFileSync(resolve(dir, "app-environment.json"), "utf8"));
  const matchedServer = [...server.values()].filter((r) => allClientIds.has(r.id));
  const candidate = distribution(candidateCpu);
  return { schema: "infraforge-g1-summary/1", scope: "local-semantic-pilot-only", timingPromotion: false, evidenceLabel: "assumption-only",
    startedAt: campaign.startedAt, endedAt: campaign.endedAt, manifest: campaign.manifest, sourceHashes: campaign.sourceHashes,
    frozenDesign: campaign.frozenDesign, hostCpu: campaign.hostCpu, images: campaign.images, postgresVersion: campaign.postgresVersion,
    postgresStorage: campaign.postgresStorage, containerLimits: campaign.containerLimits,
    appEnvironment: { bun: env.bun, versions: env.versions, kernel: env.kernel, cpu: env.cpu, visibleLogicalCpus: env.visibleLogicalCpus,
      cpuMax: env.cpuMax, memoryMax: env.memoryMax, config: env.config, dbSettings: env.dbSettings, plan: env.plan,
      sql: env.sql, keyRule: env.keyRule, datasetRows: env.datasetRows, valueBytes: env.valueBytes, isolation: env.isolation, cancellation: env.cancellation },
    missingCounters: { osRunnableQueueAge: null, perQueryDbCpu: null, fullResidentMemoryModel: null, physicalDeviceLatency: null, wireBytesIncludingHeaders: null,
      perRootCommitTimestamp: null, cancellationAcknowledgement: null, providerTransfer: null },
    missingReasons: "Not instrumented/identifiable in this pilot; point-read is read-only, no write/commit outcome. Thread CPU measured with Linux CLOCK_THREAD_CPUTIME_ID, not process-CPU subtraction. Worker wall minus CPU is not identified OS runnable wait.",
    appTelemetry: { samples: samples.length, first: counters(samples[0]), last: counters(samples.at(-1)), maxRss: samples.length ? Math.max(...samples.map((r) => r.memory.rss)) : null,
      eventLoopDelayMaxUs: samples.length ? Math.max(...samples.map((r) => r.eventLoopDelayUs?.max ?? 0)) : null,
      maxQueue: samples.length ? Math.max(...samples.map((r) => r.queued)) : null, maxPoolQueue: samples.length ? Math.max(...samples.map((r) => r.poolQueued)) : null },
    reconciliation: { serverRoots: server.size, joinedRoots: matchedServer.length, serverWithoutGenerator: server.size - matchedServer.length,
      serverCompletedDespiteCallerFailure: matchedServer.filter((s) => s.outcome === "completed" && allClientIds.get(s.id)?.outcome !== "completed").length },
    demandCandidate: { status: "unpromoted-local-input-only", operation: "cpu", subset: "observed, successful, exploratory rate levels only; no holdout/discovery/warmup", threadCpuUs: candidate,
      rootIdentitySha256: textHash([...candidateIds].sort().join("\n")), provider: null, usableAsPublicProfile: false,
      holdoutMeanRelativeErrors: windows.filter((w) => w.operation === "cpu" && w.split === "holdout").map((w) => ({ id: w.id,
        samples: w.observed.threadCpuUs?.count ?? 0, relativeError: candidate && w.observed.threadCpuUs ? (w.observed.threadCpuUs.mean - candidate.mean) / candidate.mean : null })) },
    failures: campaign.failures, startupErrors, priorAttempts: readdirSync(dir).includes("prior-attempts.json") ? JSON.parse(readFileSync(resolve(dir, "prior-attempts.json"), "utf8")) : [], windows, artifacts,
    interpretation: "Rates are discovery candidates, not established knees. Cohort throughput uses intended observed arrivals, including their later terminal outcomes. Quantiles are empirical successful-cohort descriptions, not tail confidence intervals. No engine comparison, demand activation, provider timing, full memory or whole-stack calibration is established.",
  };
}
export function validateSummary(s: Row) {
  if (s.schema !== "infraforge-g1-summary/1" || s.scope !== "local-semantic-pilot-only" || s.timingPromotion !== false || s.evidenceLabel !== "assumption-only") throw Error("Pilot claim boundary");
  if (s.demandCandidate.usableAsPublicProfile !== false || s.demandCandidate.provider !== null || s.demandCandidate.status !== "unpromoted-local-input-only") throw Error("Demand promotion forbidden");
  if (Object.values(s.missingCounters).some((v) => v !== null)) throw Error("Unknown counters changed");
  if (Object.values(s.manifest.limits).reduce((n: number, r: any) => n + r.cpus, 0) > 4 || Object.values(s.manifest.limits).reduce((n: number, r: any) => n + r.memoryMiB, 0) > 6144) throw Error("Resource cap exceeded");
  if (!s.artifacts.length || s.artifacts.some((a: Row) => !/^[a-f0-9]{64}$/.test(a.sha256) || a.bytes < 0)) throw Error("Missing raw identity");
  if (new Set(s.windows.map((w: Row) => w.id)).size !== s.windows.length) throw Error("Duplicate windows");
  for (const w of s.windows) for (const phase of ["warmup", "observed"]) {
    const p = w[phase];
    if (Object.values(p.outcomes).reduce((n: number, c: any) => n + c, 0) !== p.offered || p.sent + (p.outcomes["generator-drop"] ?? 0) !== p.offered) throw Error("Population conservation");
    if (p.serverSeen + p.sentWithoutServer !== p.sent || p.serverSeen > p.sent || p.serverSeen < 0 || p.sentWithoutServer < 0) throw Error("Server population conservation");
    for (const key of ["offered", "sent", "serverSeen", "sentWithoutServer"]) if (!Number.isSafeInteger(p[key]) || p[key] < 0) throw Error("Invalid count");
    if (Object.values(p.outcomes).some((n) => !Number.isSafeInteger(n) || Number(n) < 0)) throw Error("Invalid outcome count");
    for (const name of ["completedLatencyFromIntendedUs", "generatorLagUs", "workerQueueUs", "poolWaitUs", "threadCpuUs", "dispatchToCompleteUs"]) {
      const d = p[name]; if (d === null) continue;
      if (!Number.isSafeInteger(d.count) || d.count < 1 || [d.min, d.mean, d.p50, d.p95, d.p99, d.max].some((n) => !Number.isFinite(n) || n < 0) || !(d.min <= d.p50 && d.p50 <= d.p95 && d.p95 <= d.p99 && d.p99 <= d.max)) throw Error("Invalid distribution");
    }
  }
  for (const operation of ["cpu", "point-read"]) {
    const cells = s.windows.filter((w: Row) => w.operation === operation && ["holdout", "exploratory"].includes(w.split));
    if (cells.length !== 12 && !s.failures.length) throw Error("Missing campaign cells must remain explicit failures");
    if (cells.some((w: Row) => w.warmupS !== 30 || w.observeS !== 60 || w.rate > 1000)) throw Error("Campaign window cap");
    const holdoutRate = operation === "cpu" ? s.frozenDesign.cpuRates[1] : s.frozenDesign.pointRates[1];
    if (cells.some((w: Row) => (w.rate === holdoutRate) !== (w.split === "holdout"))) throw Error("Holdout contamination");
    if (!s.failures.length) {
      const rates = operation === "cpu" ? s.frozenDesign.cpuRates : s.frozenDesign.pointRates;
      if (new Set(rates).size !== 4 || rates.some((rate: number) => cells.filter((w: Row) => w.rate === rate && w.status === "complete").length !== 3)) throw Error("Four rates and three repeats required");
    }
  }
}
if (import.meta.main) {
  const dir = process.argv[2]; if (!dir) throw Error("Usage: summary.ts <raw-directory> <new-summary-path>");
  const path = process.argv[3]; if (!path) throw Error("Summary output required");
  const s = await buildSummary(resolve(dir)); validateSummary(s);
  const text = JSON.stringify(s, null, 2) + "\n"; writeFileSync(path, text); writeFileSync(`${path}.sha256`, textHash(text) + "\n");
  console.log(JSON.stringify({ windows: s.windows.length, artifacts: s.artifacts.length, sha256: textHash(text) }));
}
