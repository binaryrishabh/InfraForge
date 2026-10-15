import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { pbkdf2Sync, createHash } from "node:crypto";
import { cpus, availableParallelism, platform, arch, release } from "node:os";
import { readFileSync } from "node:fs";
const iterations = { light: 8000, heavy: 64000 };
if (!isMainThread) {
  const password = Buffer.alloc(64, 97), salt = Buffer.alloc(16, 98);
  const work = (operation) => pbkdf2Sync(password, salt, iterations[operation], 32, "sha256")[0];
  let allocation;
  if (workerData.mode === "cpu") for (let i = 0; i < 8; i++) { work("light"); work("heavy"); }
  parentPort.on("message", (m) => {
    if (m.kind === "job") { const start = process.hrtime.bigint(); const checksum = work(m.operation); parentPort.postMessage({ id: m.id, serviceWallUs: Number(process.hrtime.bigint() - start) / 1000, checksum }); }
    else if (m.kind === "allocate") { allocation = Buffer.alloc(m.bytes, 37); parentPort.postMessage({ allocated: allocation.byteLength }); }
    else if (m.kind === "release") { allocation = undefined; global.gc?.(); parentPort.postMessage({ released: true, gcAvailable: typeof global.gc === "function" }); }
  });
  parentPort.postMessage({ ready: true });
} else {
  const cfg = JSON.parse(process.argv[2]), host = { scope: "owner-local-host-only", cpu: cpus()[0].model, logicalProcessors: cpus().length, availableParallelism: availableParallelism(), physicalCores: { kind: "unknown", reason: "Node logical processor inventory does not establish physical topology or SMT equivalence" }, platform: platform(), release: release(), arch: arch(), node: process.version, openssl: process.versions.openssl };
  const sourceHash = createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex");
  const environment = createHash("sha256").update(JSON.stringify(host)).digest("hex");
  const pool = [], once = (worker) => new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
  const startup = performance.now(), initialMemory = process.memoryUsage();
  for (let i = 0; i < cfg.workers; i++) { const w = new Worker(new URL(import.meta.url), { workerData: { mode: cfg.mode } }); pool.push(w); }
  await Promise.all(pool.map(once));
  const startupMs = performance.now() - startup;
  try {
    if (cfg.mode === "cpu") {
      const records = [];
      for (const mix of ["light", "heavy", "mix90", "mix50"]) for (let repeat = 0; repeat < (mix.startsWith("mix") ? 1 : 3); repeat++) {
        const operations = Array.from({ length: 128 }, (_, i) => mix === "heavy" || (mix === "mix90" && i % 10 === 9) || (mix === "mix50" && i % 2) ? "heavy" : "light");
        const used = process.cpuUsage(), start = process.hrtime.bigint(), results = []; let next = 0;
        await new Promise((resolve, reject) => {
          const issue = (worker) => {
            if (next >= operations.length) return;
            const index = next++, operation = operations[index]; worker.postMessage({ kind: "job", id: index, operation });
          };
          const handlers = pool.map((worker) => {
            const handler = (message) => { results.push({ id: message.id, operation: operations[message.id], responseUs: Number(process.hrtime.bigint() - start) / 1000, serviceWallUs: message.serviceWallUs }); if (results.length === operations.length) { pool.forEach((w, i) => w.off("message", handlers[i])); resolve(); } else issue(worker); };
            worker.on("message", handler); worker.once("error", reject); return handler;
          });
          pool.forEach(issue);
        });
        const wallUs = Number(process.hrtime.bigint() - start) / 1000, cpu = process.cpuUsage(used);
        records.push({ id: `${cfg.workers}/${mix}/${repeat}`, workers: cfg.workers, mix, repeat, split: [2, 8].includes(cfg.workers) || mix.startsWith("mix") || repeat === 2 ? "holdout" : "fit", configurationHoldout: [2, 8].includes(cfg.workers), operations: operations.length, cpuCoreUs: cpu.user + cpu.system, wallUs, achievedPerSecond: operations.length * 1000000 / wallUs, offered: "128 authored simultaneous arrivals; bounded FCFS worker dispatch; no response-gated offered load", results: results.sort((a, b) => a.id - b.id), memory: process.memoryUsage() });
      }
      console.log(JSON.stringify({ schema: "infraforge-compute-measurements/1", date: new Date().toISOString(), sourceHash, environment, host, startupMs, workers: cfg.workers, warmupPerWorkerPerClass: 8, configuration: { iterations, passwordBytes: 64, saltBytes: 16, outputBytes: 32, invocationParallelism: 1, parallelismProvenance: "Each worker invokes one synchronous PBKDF2 operation; application code creates no per-invocation parallel jobs. Native implementation scope is this recorded Node/OpenSSL build." }, cpuResolutionUs: platform() === "win32" ? 15625 : 1, records }));
    } else if (cfg.mode === "memory") {
      const samples = [], workerBaseline = process.memoryUsage();
      for (const bytes of [0, 4194304, 16777216]) {
        const allocate = pool.map((w) => { const done = once(w); w.postMessage({ kind: "allocate", bytes }); return done; }); await Promise.all(allocate);
        await new Promise((r) => setTimeout(r, 100)); const allocated = process.memoryUsage();
        const release = pool.map((w) => { const done = once(w); w.postMessage({ kind: "release" }); return done; }); const acknowledgements = await Promise.all(release);
        global.gc?.(); await new Promise((r) => setTimeout(r, 100));
        samples.push({ perWorkerAllocatedBytes: bytes, totalExplicitBufferBytes: bytes * cfg.workers, allocated, afterRelease: process.memoryUsage(), acknowledgements });
      }
      console.log(JSON.stringify({ schema: "infraforge-memory-measurements/1", date: new Date().toISOString(), sourceHash, environment, host, workers: cfg.workers, initialMemory, workerBaseline, samples, residentMapping: { kind: "unknown", reason: "RSS includes shared/runtime/native/allocator state; buffer ownership and release do not identify exact resident components or reclamation." } }));
    } else throw new Error("Unknown benchmark mode");
  } finally { await Promise.all(pool.map((w) => w.terminate())); }
}
