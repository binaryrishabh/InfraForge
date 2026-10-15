// Local controlled application, not a cloud or general-purpose HTTP benchmark.
import { pbkdf2Sync, createHash } from "node:crypto";
import { cpus, release, arch, platform } from "node:os";
import { readFileSync } from "node:fs";
const config = JSON.parse(process.argv[2]);
const sourceHash = createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex");
const host = { scope: "owner-local-host-only", cpu: cpus()[0].model, os: platform(), release: release(), arch: arch(), node: process.version, openssl: process.versions.openssl };
const environment = `local:${createHash("sha256").update(JSON.stringify(host)).digest("hex")}`;
const software = `pbkdf2-sha256-v1:${sourceHash}:${process.version}:${process.versions.openssl}`;
const password = Buffer.alloc(64, 97), salt = Buffer.alloc(16, 98);
const iterations = { light: 8000, heavy: 64000 };
let checksum = 0;
const operation = (id) => { checksum ^= pbkdf2Sync(password, salt, iterations[id], 32, "sha256")[0]; };
const now = () => Number(process.hrtime.bigint()) / 1000;
const cpu = (before) => { const used = process.cpuUsage(before); return used.user + used.system; };
if (config.mode === "batches") {
  const records = [];
  for (let round = 0; round < 12; round++) for (const id of round % 2 ? ["heavy", "light"] : ["light", "heavy"]) {
    for (let i = 0; i < 16; i++) operation(id);
    const start = now(), used = process.cpuUsage();
    for (let i = 0; i < 64; i++) operation(id);
    records.push({ schema: "infraforge-benchmark/1", id: `${id}/${round}`, runId: `${id}/${round}`, split: round % 3 === 2 ? "holdout" : "fit",
      application: "controlled-pbkdf2-v1", operation: id, software, environment, date: new Date().toISOString().slice(0, 10),
      provenance: `docs/reality/m2b-measurements.json#${id}/${round}`, configuration: { iterations: String(iterations[id]), payloadBytes: "64", saltBytes: "16", outputBytes: "32", digest: "sha256", workers: "1", warm: "yes" },
      warmupOperations: 16, operations: 64, cpuCoreUs: cpu(used), wallUs: now() - start,
      cpuResolutionUs: process.platform === "win32" ? 15625 : 1, measurement: "serial-batch-cpu",
      limitations: ["Current host/process/runtime only; CPU frequency and interference uncontrolled", "Warm serial crypto operation, not an HTTP or cloud SKU workload", "Conservative CPU timer granularity; batch averaging does not identify per-request variance"] });
  }
  console.log(JSON.stringify({ host, environment, software, sourceHash, records, checksum }));
} else if (config.mode === "trace") {
  if (!Array.isArray(config.rows) || config.rows.length > 100000 || config.rows.some((r, i) => !iterations[r.operation] || !Number.isSafeInteger(r.atUs) || r.atUs < 0 || (i && r.atUs < config.rows[i - 1].atUs))) throw new Error("Invalid benchmark trace");
  for (let i = 0; i < 32; i++) { operation("light"); operation("heavy"); }
  const results = [], wait = new Int32Array(new SharedArrayBuffer(4));
  const used = process.cpuUsage(), start = now();
  let maxReadyQueue = 0, executionWallUs = 0;
  for (let i = 0; i < config.rows.length; i++) {
    const row = config.rows[i];
    while (now() - start < row.atUs) Atomics.wait(wait, 0, 0, Math.max(0.001, (row.atUs - (now() - start)) / 1000));
    const began = now() - start;
    let due = i + 1; while (due < config.rows.length && config.rows[due].atUs <= began) due++;
    maxReadyQueue = Math.max(maxReadyQueue, due - i - 1);
    operation(row.operation);
    const finished = now() - start; executionWallUs += finished - began;
    results.push({ id: row.id, operation: row.operation, offeredAtUs: row.atUs, beganUs: began, finishedUs: finished, responseUs: finished - row.atUs });
  }
  console.log(JSON.stringify({ host, environment, software, sourceHash, trace: config.rows, results, cpuCoreUs: cpu(used), elapsedUs: now() - start, executionWallUs, maxReadyQueue,
    semantics: "All authored arrivals offered independently; serial FCFS with queue sized for the entire bounded trace. Response measured from intended arrival, including generator lateness. No transport.", checksum }));
} else throw new Error("Unknown measurement mode");
