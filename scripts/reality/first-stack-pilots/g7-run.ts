import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { textHash } from "./summary";

const source = resolve(import.meta.dir), output = resolve(process.argv[2] ?? "");
if (!process.argv[2] || existsSync(output) || output.startsWith(resolve(source, "../../.."))) throw Error("Provide a new immutable external capture directory");
const manifest = JSON.parse(readFileSync(resolve(source, "g7-manifest.json"), "utf8"));
if (manifest.limits.cpus > 3 || manifest.limits.memoryMiB > 5120 || manifest.limits.containers !== 1) throw Error("Shared host cap exceeded");
const docker = (args: string[], timeout = 30000) => execFileSync("docker", args, { encoding: "utf8", timeout, maxBuffer: 4 * 1024 * 1024 }).trim();
const peers = docker(["ps", "--format", "{{.Names}}\t{{.Image}}"] ).split("\n").filter(s => s && !s.includes("moby/buildkit"));
if (peers.length) throw Error("Another container is running; defer the single-container G7 campaign");
mkdirSync(output, { recursive: true });
const name = `ifg-g7-${Date.now()}`, image = "infraforge-g7:local";
const record: any = { schema: manifest.schema, manifest, startedAt: new Date().toISOString(), failures: [],
  sourceHashes: Object.fromEntries(["g7-run.ts", "g7-probe.ts", "g7-manifest.json", "G7.Dockerfile", "telemetry.ts"].map(p => [p, textHash(readFileSync(resolve(source, p), "utf8"))])) };
const save = () => writeFileSync(resolve(output, "campaign.json"), JSON.stringify(record, null, 2) + "\n"); save();
try {
  record.build = docker(["build", "-f", resolve(source, "G7.Dockerfile"), "-t", image, source], 120000);
  record.image = docker(["image", "inspect", image, "--format", "{{.Id}}"]);
  docker(["run", "-d", "--name", name, "--network", "none", "--cpus", String(manifest.limits.cpus), "--memory", `${manifest.limits.memoryMiB}m`, "--memory-swap", `${manifest.limits.memoryMiB}m`, "--pids-limit", "128",
    "--mount", `type=bind,source=${source},target=/harness,readonly`, image]);
  record.limits = { cpu: docker(["inspect", name, "--format", "{{.HostConfig.NanoCpus}}"]), memory: docker(["inspect", name, "--format", "{{.HostConfig.Memory}}"] ) }; save();
  // /out lives on the container filesystem; synchronous raw IO never crosses
  // the Windows bind mount. The watchdog is external to the measured process.
  const wait = Bun.spawn(["docker", "wait", name], { stdout: "pipe", stderr: "pipe" });
  const deadline = setTimeout(() => { try { docker(["kill", name]); } catch {} }, manifest.limits.hardStopSeconds * 1000);
  try { await wait.exited; record.exit = Number(await new Response(wait.stdout).text()); } finally { clearTimeout(deadline); }
  record.oomKilled = docker(["inspect", name, "--format", "{{.State.OOMKilled}}"]);
  if (record.exit !== 0) throw Error(`G7 probe exit ${record.exit}`);
} catch (e) { record.failures.push(String(e)); process.exitCode = 1; }
finally {
  try { const logs = Bun.spawnSync(["docker", "logs", name]); writeFileSync(resolve(output, "container.log"), Buffer.concat([logs.stdout, logs.stderr])); } catch {}
  try { docker(["cp", `${name}:/out/.`, output]); } catch (e) { record.failures.push(String(e)); process.exitCode = 1; }
  try { docker(["rm", "-f", "-v", name]); } catch {}
  record.endedAt = new Date().toISOString(); save();
}
console.log(JSON.stringify({ capture: output, exit: record.exit, failures: record.failures }));
