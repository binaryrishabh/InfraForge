import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { textHash } from "./summary";

const source = resolve(import.meta.dir), output = resolve(process.argv[2] ?? "");
if (!process.argv[2] || existsSync(output)) throw Error("Provide a new immutable external capture directory");
if (output.startsWith(resolve(source, "../../.."))) throw Error("Raw captures must be outside repository");
const manifest = JSON.parse(readFileSync(resolve(source, "g5-manifest.json"), "utf8"));
if (Object.values(manifest.limits).reduce((n: number, r: any) => n + r.cpus, 0) > 3 || Object.values(manifest.limits).reduce((n: number, r: any) => n + r.memoryMiB, 0) > 5120) throw Error("Shared host cap exceeded");
const images = JSON.parse(readFileSync(resolve(source, "manifest.json"), "utf8")).images;
mkdirSync(output, { recursive: true });
const prefix = `ifg-g5-${Date.now()}`, pg = `${prefix}-pg`, net = `${prefix}-net`, volume = `${prefix}-raw`, names = [pg];
const started = Date.now();
const docker = (args: string[], timeout = 30000, input?: string) => {
  if (Date.now() - started > manifest.hardStopSeconds * 1000 && !["rm", "logs", "cp", "network", "volume"].includes(args[0]!)) throw Error("G5 campaign hard stop");
  return execFileSync("docker", args, { encoding: "utf8", timeout, maxBuffer: 4 * 1024 * 1024, input }).trim();
};
const limits = (role: string) => { const l = manifest.limits[role]; return ["--cpus", String(l.cpus), "--memory", `${l.memoryMiB}m`, "--memory-swap", `${l.memoryMiB}m`, "--pids-limit", "128"]; };
const record: any = { schema: manifest.schema, manifest, startedAt: new Date().toISOString(), failures: [], phases: [],
  sourceHashes: Object.fromEntries(["g5-run.ts", "g5-probe.ts", "g5-manifest.json", "telemetry.ts", "manifest.json"].map(p => [p, textHash(readFileSync(resolve(source, p), "utf8"))])) };
const save = () => writeFileSync(resolve(output, "campaign.json"), JSON.stringify(record, null, 2) + "\n");
save();
const psql = (text: string) => docker(["exec", pg, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "pilot", "-c", text]);
let address = "", data = "";
async function phase(mode: string, shutdown?: "smart" | "fast") {
  const probe = `${prefix}-${mode}`; names.push(probe);
  const row: any = { mode, startedAt: new Date().toISOString() }; record.phases.push(row); save();
  docker(["run", "-d", "--name", probe, ...limits("probe"), "--network", net,
    "--mount", `type=bind,source=${source},target=/harness,readonly`, "--mount", `type=volume,source=${volume},target=/out`,
    images.runtime, "bun", "--no-env-file", "/harness/g5-probe.ts", address, mode]);
  row.limits = { cpu: docker(["inspect", probe, "--format", "{{.HostConfig.NanoCpus}}"]), memory: docker(["inspect", probe, "--format", "{{.HostConfig.Memory}}"] ) }; save();
  if (shutdown) {
    for (let i = 0; ; i++) {
      try { docker(["exec", probe, "bun", "--no-env-file", "-e", `if(!await Bun.file('/out/${mode}.ready').exists())process.exit(1)`]); break; }
      catch { if (i >= 40) throw Error("Shutdown probe not ready"); await Bun.sleep(100); }
    }
    row.signalAt = new Date().toISOString();
    row.signal = docker(["exec", "--user", "postgres", pg, "pg_ctl", "-D", data, "-m", shutdown, "-W", "stop"]);
    if (shutdown === "smart") {
      // The server must still exist while the explicit transaction drains.
      row.runningAfterSignal = docker(["inspect", pg, "--format", "{{.State.Running}}"]);
    }
  }
  row.exit = Number(docker(["wait", probe], 60000)); row.endedAt = new Date().toISOString();
  const logs = Bun.spawnSync(["docker", "logs", probe]); writeFileSync(resolve(output, `${mode}-container.log`), Buffer.concat([logs.stdout, logs.stderr]));
  docker(["cp", `${probe}:/out/.`, output]); save();
  if (row.exit !== 0) throw Error(`Probe ${mode} failed`);
}
try {
  record.images = Object.fromEntries(Object.entries(images).map(([role, image]) => [role, docker(["image", "inspect", String(image), "--format", "{{.Id}}"])]));
  docker(["network", "create", "--internal", net]); docker(["volume", "create", volume]);
  // Install the separate pooler adapter before isolating the disposable server.
  docker(["run", "-d", "--name", pg, ...limits("postgres"), "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_DB=pilot", images.postgres,
    "-c", "max_connections=8", "-c", "superuser_reserved_connections=2", "-c", "reserved_connections=1"]);
  record.poolerPackage = docker(["exec", pg, "apk", "add", "--no-cache", "pgbouncer=1.25.2-r0"], 60000);
  record.poolerVersion = docker(["exec", pg, "pgbouncer", "--version"]);
  docker(["network", "connect", net, pg]); docker(["network", "disconnect", "bridge", pg]);
  address = docker(["inspect", pg, "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"]);
  for (let i = 0; ; i++) { try { psql("SELECT 1"); break; } catch { if (i > 30) throw Error("PG readiness failed"); await Bun.sleep(200); } }
  data = docker(["exec", pg, "psql", "-X", "-At", "-U", "postgres", "-d", "pilot", "-c", "SHOW data_directory"]);
  record.postgresVersion = docker(["exec", pg, "postgres", "--version"]);
  record.postgresLimits = { cpu: docker(["inspect", pg, "--format", "{{.HostConfig.NanoCpus}}"]), memory: docker(["inspect", pg, "--format", "{{.HostConfig.Memory}}"] ) };
  record.storage = docker(["exec", pg, "sh", "-c", "df -T /var/lib/postgresql; cat /sys/fs/cgroup/cpu.max /sys/fs/cgroup/memory.max"]);
  record.setup = psql("CREATE ROLE pilot_app LOGIN; CREATE TABLE pilot_keys(id int PRIMARY KEY,value int); INSERT INTO pilot_keys VALUES(1,0); CREATE TABLE pilot_commits(id int PRIMARY KEY,value int); GRANT SELECT,UPDATE ON pilot_keys TO pilot_app; GRANT SELECT,INSERT ON pilot_commits TO pilot_app;"); save();
  await phase("baseline");
  psql("ALTER SYSTEM SET synchronous_standby_names=''"); psql("SELECT pg_reload_conf()");
  const config = `[databases]\npilot = host=127.0.0.1 port=5432 dbname=pilot\n[pgbouncer]\nlisten_addr = 0.0.0.0\nlisten_port = 6432\nauth_type = trust\nauth_file = /tmp/g5-users.txt\npool_mode = transaction\ndefault_pool_size = 1\nmax_client_conn = 16\nlogfile = /tmp/g5-pooler.log\npidfile = /tmp/g5-pooler.pid\n`;
  docker(["exec", "-i", pg, "sh", "-c", "cat > /tmp/g5-pooler.ini"], 30000, config);
  docker(["exec", "-i", pg, "sh", "-c", "cat > /tmp/g5-users.txt"], 30000, '"pilot_app" ""\n');
  docker(["exec", "-d", "--user", "postgres", pg, "pgbouncer", "/tmp/g5-pooler.ini"]); await Bun.sleep(200);
  await phase("pooler"); docker(["exec", pg, "sh", "-c", "kill $(cat /tmp/g5-pooler.pid)"]);
  await phase("smart", "smart"); docker(["wait", pg], 10000);
  docker(["start", pg]); for (let i = 0; ; i++) { try { psql("SELECT 1"); break; } catch { if (i > 30) throw Error("PG restart failed"); await Bun.sleep(200); } }
  record.afterSmart = psql("TABLE pilot_keys");
  await phase("fast", "fast"); docker(["wait", pg], 10000);
  docker(["start", pg]); for (let i = 0; ; i++) { try { psql("SELECT 1"); break; } catch { if (i > 30) throw Error("PG restart failed"); await Bun.sleep(200); } }
  record.afterFast = psql("TABLE pilot_keys");
} catch (error) { record.failures.push(String(error)); process.exitCode = 1; }
finally {
  try { const logs = Bun.spawnSync(["docker", "logs", pg]); writeFileSync(resolve(output, "pg-container.log"), Buffer.concat([logs.stdout, logs.stderr])); } catch {}
  for (const name of names.reverse()) { try { docker(["rm", "-f", "-v", name]); } catch {} }
  try { docker(["network", "rm", net]); } catch {} try { docker(["volume", "rm", volume]); } catch {}
  record.endedAt = new Date().toISOString(); save();
}
console.log(JSON.stringify({ capture: output, phases: record.phases.length, failures: record.failures }));
