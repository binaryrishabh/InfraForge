import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const source = resolve(import.meta.dir), output = resolve(process.argv[2] ?? "");
if (!process.argv[2] || existsSync(output)) throw Error("Provide a new external artifact directory; existing captures are immutable");
if (output.startsWith(resolve(source, "../../.."))) throw Error("Raw captures must be outside the repository");
const manifest = JSON.parse(readFileSync(resolve(source, "manifest.json"), "utf8"));
if (Object.values(manifest.limits).reduce((sum: number, l: any) => sum + l.cpus, 0) > 4 || Object.values(manifest.limits).reduce((sum: number, l: any) => sum + l.memoryMiB, 0) > 6144) throw Error("Shared laptop resource cap exceeded");
mkdirSync(output, { recursive: true });
const prefix = `ifg-g1-${Date.now()}`, network = `${prefix}-net`, volume = `${prefix}-raw`, names: string[] = [];
const docker = (args: string[], timeout = 30000) => execFileSync("docker", args, { encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024 }).trim();
// Keep the harness mount distinct from the database name: this Bun build treats
// an existing /pilot path as a socket path when the URL database is also pilot.
const mounts = ["--mount", `type=bind,source=${source},target=/harness,readonly`, "--mount", `type=volume,source=${volume},target=/out`];
const limits = (role: string) => ["--cpus", String(manifest.limits[role].cpus), "--memory", `${manifest.limits[role].memoryMiB}m`, "--memory-swap", `${manifest.limits[role].memoryMiB}m`, "--pids-limit", "128"];
const record: any = { schema: manifest.schema, startedAt: new Date().toISOString(), manifest, windows: [], failures: [],
  sourceHashes: Object.fromEntries(["app.ts", "worker.ts", "generator.ts", "telemetry.ts", "run.ts", "manifest.json"].map((p) => [p, createHash("sha256").update(readFileSync(resolve(source, p), "utf8").replaceAll("\r\n", "\n")).digest("hex")])),
  hostCpu: JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors | ConvertTo-Json -Compress"], { encoding: "utf8" })),
};
const save = () => writeFileSync(resolve(output, "campaign.json"), JSON.stringify(record, null, 2) + "\n");
save();
async function window(operation: string, rate: number, id: string, warmupS: number, observeS: number, split: string, label: string) {
  if (!(rate > 0 && rate <= manifest.generator.maxRate)) throw Error("Generator rate cap");
  const config = { ...manifest.generator, operation, rate, id, warmupS, observeS, split, label };
  const row: any = { ...config, startedAt: new Date().toISOString(), status: "running" }; record.windows.push(row); save();
  const name = `${prefix}-gen`; names.push(name);
  try {
    docker(["run", "--rm", "--name", name, ...limits("generator"), "--network", network, ...mounts,
      manifest.images.runtime, "bun", "--no-env-file", "/harness/generator.ts", JSON.stringify(config)], (warmupS + observeS + 15) * 1000);
    row.status = "complete"; row.exit = 0; row.stderr = "";
  } catch (error) { row.status = "failed"; row.exit = null; row.stderr = String(error); record.failures.push({ id, reason: row.stderr }); try { docker(["rm", "-f", name]); } catch {} }
  row.endedAt = new Date().toISOString(); save(); console.log(`${id}: ${row.status} @ ${rate}/s`);
}
try {
  record.images = Object.fromEntries(Object.entries(manifest.images).map(([role, image]) => [role, JSON.parse(docker(["image", "inspect", String(image), "--format", "{{json .Id}}" ]))])); save();
  docker(["network", "create", "--internal", network]);
  docker(["volume", "create", volume]); record.rawFilesystem = "Docker native volume; exported after capture; no per-root Windows bind writes"; save();
  const pg = `${prefix}-pg`; names.push(pg);
  docker(["run", "-d", "--name", pg, "--network", network, "--network-alias", "pg", ...limits("postgres"), "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_DB=pilot", manifest.images.postgres]);
  for (let i = 0; ; i++) { try { docker(["exec", pg, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "pilot"]); break; } catch { if (i > 30) throw Error("PostgreSQL readiness failed"); await Bun.sleep(500); } }
  record.postgresVersion = docker(["exec", pg, "postgres", "--version"]);
  const postgresHost = docker(["inspect", pg, "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"]);
  record.postgresStorage = docker(["exec", pg, "sh", "-c", "df -T /var/lib/postgresql; cat /sys/fs/cgroup/cpu.max /sys/fs/cgroup/memory.max"]);
  const app = `${prefix}-app`; names.push(app);
  docker(["run", "-d", "--name", app, "--network", network, "--network-alias", "app", ...limits("app"), ...mounts, manifest.images.runtime, "bun", "--no-env-file", "/harness/app.ts", JSON.stringify({ ...manifest.app, postgresHost })]);
  for (let i = 0; ; i++) { try { docker(["exec", app, "bun", "--no-env-file", "-e", "const r=await fetch('http://localhost:8080/ready');if(!r.ok)process.exit(1)"]); break; } catch { if (i > 40) throw Error("App readiness failed"); await Bun.sleep(500); } }
  // Read only selected non-secret fields from Docker metadata.
  record.containerLimits = [pg, app].map((name) => ({ name, cpu: docker(["inspect", name, "--format", "{{.HostConfig.NanoCpus}}"]), memory: docker(["inspect", name, "--format", "{{.HostConfig.Memory}}"]), memorySwap: docker(["inspect", name, "--format", "{{.HostConfig.MemorySwap}}"]), pids: docker(["inspect", name, "--format", "{{.HostConfig.PidsLimit}}"] ) })); save();
  for (const [i, d] of manifest.discovery.entries()) await window(d.operation, d.rate, `discovery-${i}`, 2, 5, "discovery", "discovery");
  docker(["cp", `${app}:/out/.`, output]);
  const cpuRows = manifest.discovery.flatMap((d: any, i: number) => d.operation === "cpu" ? readFileSync(resolve(output, `discovery-${i}.jsonl`), "utf8").trim().split("\n").map((s) => JSON.parse(s)).filter((r) => r.kind === "root" && r.phase === "observed" && r.outcome === "completed") : []);
  const appRows = readFileSync(resolve(output, "app.jsonl"), "utf8").trim().split("\n").map((s) => JSON.parse(s));
  const ids = new Set(cpuRows.map((r: any) => r.id)), demands = appRows.filter((r) => ids.has(r.id) && typeof r.threadCpuUs === "number").map((r) => r.threadCpuUs);
  if (!demands.length) throw Error("Discovery has no observed CPU demand");
  const cpuMean = demands.reduce((a, b) => a + b, 0) / demands.length;
  const knee = Math.min(600, Math.floor(2e6 / cpuMean));
  record.frozenDesign = { at: new Date().toISOString(), discoveryCpuMeanUs: cpuMean, discoverySamples: demands.length,
    cpuRates: [Math.max(1, Math.floor(knee * .3)), Math.max(2, Math.floor(knee * .9)), Math.min(1000, Math.ceil(knee * 1.6)), Math.max(1, Math.floor(knee * .15))],
    pointRates: [30, 300, 1000, 15], pointRateReason: "bounded exploration up to generator safety ceiling; saturation may remain unobserved",
    holdoutIndex: 1, fit: "none; discovery used for rate design only", recovery: "low-rate candidate; no causal recovery claim without chronological predecessor" }; save();
  await window("empty", 100, "empty-control", 30, 60, "control", "empty-ipc");
  let seed = manifest.seed;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (const operation of ["cpu", "point-read"]) {
    const sweepStart = Date.now(), rates = operation === "cpu" ? record.frozenDesign.cpuRates : record.frozenDesign.pointRates;
    const cells = Array.from({ length: 3 }, (_, repeat) => rates.map((rate: number, index: number) => ({ rate, index, repeat }))).flat();
    for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
    record[`${operation}Order`] = cells; save();
    for (const cell of cells) {
      if (Date.now() - sweepStart + 105000 > manifest.window.sweepHardStopS * 1000) { record.failures.push({ operation, cell, reason: "sweep-hard-stop; cell Unknown" }); save(); break; }
      await window(operation, cell.rate, `${operation}-${cell.index}-${cell.repeat}`, 30, 60, cell.index === 1 ? "holdout" : "exploratory", ["below-candidate", "near-candidate", "above-candidate", "recovery-candidate"][cell.index]!);
    }
  }
} catch (e) { record.failures.push({ reason: String(e) }); process.exitCode = 1; }
finally {
  record.endedAt = new Date().toISOString();
  const app = names.find((name) => name.endsWith("-app"));
  if (app) { try { docker(["stop", "--time", "3", app]); docker(["cp", `${app}:/out/.`, output], 120000); } catch (e) { record.failures.push({ reason: `Raw export failed: ${String(e)}` }); } }
  for (const name of names.reverse()) { try { if (name.endsWith("-app") || name.endsWith("-pg")) { const logs = Bun.spawnSync(["docker", "logs", name]); writeFileSync(resolve(output, `${name.endsWith("-app") ? "app" : "pg"}-container.log`), Buffer.concat([logs.stdout, logs.stderr])); } docker(["rm", "-f", "-v", name]); } catch {} }
  try { docker(["network", "rm", network]); } catch {} try { docker(["volume", "rm", volume]); } catch {} save();
}
