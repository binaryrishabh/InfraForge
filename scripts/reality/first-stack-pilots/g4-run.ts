import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { textHash } from "./summary";

export const g4Sources = ["g4-run.ts", "g4-probe.ts", "g4-manifest.json", "telemetry.ts", "manifest.json", ...["point-read", "independent-update", "hot-update", "range-read"].map(op => `g4-${op}.sql`)];
export function g4Order(manifest: any) {
  let seed = manifest.seed;
  return manifest.datasets.flatMap((dataset: any) => {
    const cells = Array.from({ length: manifest.repeats }, (_, repeat) => manifest.operations.flatMap((operation: string) => manifest.clients.map((clients: number) => ({ dataset: dataset.id, rows: dataset.rows, operation, clients, repeat })))).flat();
    for (let i = cells.length - 1; i > 0; i--) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const j = Math.floor(seed / 2 ** 32 * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    return cells;
  });
}
if (import.meta.main) {
  const source = resolve(import.meta.dir), root = resolve(source, "../../.."), output = resolve(process.argv[2] ?? "");
  const rel = relative(root, output);
  if (!process.argv[2] || existsSync(output) || (!rel.startsWith("..") && !isAbsolute(rel))) throw Error("Provide a new external capture directory");
  const manifest = JSON.parse(readFileSync(resolve(source, "g4-manifest.json"), "utf8"));
  if (Object.values(manifest.limits).reduce((n: number, r: any) => n + r.cpus, 0) > 3 || Object.values(manifest.limits).reduce((n: number, r: any) => n + r.memoryMiB, 0) > 5120) throw Error("G4 shared host cap");
  const images = JSON.parse(readFileSync(resolve(source, "manifest.json"), "utf8")).images;
  mkdirSync(output, { recursive: true });
  const prefix = `ifg-g4-${Date.now()}`, pg = `${prefix}-pg`, probe = `${prefix}-probe`, net = `${prefix}-net`, raw = `${prefix}-raw`, data = `${prefix}-data`, names = [pg, probe];
  const started = Date.now();
  const docker = (args: string[], timeout = 30000, input?: string) => execFileSync("docker", args, { encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024, input }).trim();
  const limits = (role: string) => { const l = manifest.limits[role]; return ["--cpus", String(l.cpus), "--memory", `${l.memoryMiB}m`, "--memory-swap", `${l.memoryMiB}m`, "--pids-limit", "128"]; };
  const mounts = ["--mount", `type=bind,source=${source},target=/harness,readonly`, "--mount", `type=volume,source=${raw},target=/out`];
  const record: any = { schema: manifest.schema, manifest, startedAt: new Date().toISOString(), order: g4Order(manifest), windows: [], datasets: [], failures: [],
    sourceHashes: Object.fromEntries(g4Sources.map(p => [p, textHash(readFileSync(resolve(source, p), "utf8"))])) };
  const save = () => writeFileSync(resolve(output, "campaign.json"), JSON.stringify(record, null, 2) + "\n");
  const psql = (sql: string, timeout = 30000) => docker(["exec", pg, "psql", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "pilot", "-c", sql], timeout);
  const snapshot = () => ({ at: new Date().toISOString(), stats: JSON.parse(psql(`SELECT json_build_object(
    'database',(SELECT row_to_json(t) FROM pg_stat_database t WHERE datname='pilot'),
    'io',(SELECT json_agg(t) FROM pg_stat_io t), 'wal',(SELECT row_to_json(t) FROM pg_stat_wal t),
    'checkpointer',(SELECT row_to_json(t) FROM pg_stat_checkpointer t), 'bgwriter',(SELECT row_to_json(t) FROM pg_stat_bgwriter t),
    'tables',(SELECT json_agg(t) FROM pg_stat_user_tables t), 'statements',(SELECT json_agg(t) FROM pg_stat_statements t WHERE dbid=(SELECT oid FROM pg_database WHERE datname='pilot')))`)),
    cgroup: docker(["exec", pg, "sh", "-c", "for f in cpu.stat cpu.pressure memory.current memory.events io.stat io.pressure; do echo $f; cat /sys/fs/cgroup/$f; done"]),
    diskstats: docker(["exec", pg, "cat", "/proc/diskstats"]) });
  save();
  try {
    record.images = Object.fromEntries(Object.entries(images).map(([role, image]) => [role, docker(["image", "inspect", String(image), "--format", "{{.Id}}"])]));
    record.hostCpu = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors | ConvertTo-Json -Compress"], { encoding: "utf8" }));
    docker(["network", "create", "--internal", net]); docker(["volume", "create", raw]); docker(["volume", "create", data]);
    docker(["run", "-d", "--name", pg, ...limits("postgres"), "--network", net, "--mount", `type=volume,source=${data},target=/var/lib/postgresql`, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_DB=pilot", images.postgres,
      "-c", `shared_buffers=${manifest.sharedBuffersMiB}MB`, "-c", "shared_preload_libraries=pg_stat_statements", "-c", "track_io_timing=on", "-c", "track_wal_io_timing=on", "-c", "fsync=on", "-c", "synchronous_commit=on", "-c", "log_checkpoints=on", "-c", "log_autovacuum_min_duration=0", "-c", "max_connections=32"]);
    for (let i = 0; ; i++) { try { psql("SELECT 1"); break; } catch { if (i > 40) throw Error("PG readiness failed"); await Bun.sleep(250); } }
    psql("CREATE EXTENSION pg_stat_statements; CREATE ROLE pilot_app LOGIN; GRANT CONNECT ON DATABASE pilot TO pilot_app;");
    record.version = psql("SELECT version()");
    record.settings = JSON.parse(psql("SELECT json_agg(t) FROM (SELECT name,setting,unit,source FROM pg_settings WHERE name IN ('server_version','block_size','shared_buffers','fsync','synchronous_commit','wal_sync_method','full_page_writes','checkpoint_timeout','checkpoint_completion_target','max_wal_size','autovacuum','track_io_timing','track_wal_io_timing','default_transaction_isolation','max_connections','huge_pages','effective_io_concurrency') ORDER BY name) t"));
    record.storage = docker(["exec", pg, "sh", "-c", "df -T /var/lib/postgresql; cat /proc/mounts; cat /sys/fs/cgroup/cpu.max /sys/fs/cgroup/memory.max; uname -a; cat /proc/cpuinfo"]);
    const address = docker(["inspect", pg, "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"]);
    docker(["run", "-d", "--name", probe, ...limits("probe"), "--network", net, ...mounts, images.runtime, "bun", "--no-env-file", "/harness/g4-probe.ts", address]);
    record.actualLimits = Object.fromEntries([["postgres", pg], ["probe", probe]].map(([role, name]) => [role!, docker(["inspect", name!, "--format", '{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.PidsLimit}}'])])); save();
    for (const dataset of manifest.datasets) {
      psql(`DROP TABLE IF EXISTS pilot_keys; CREATE TABLE pilot_keys(id int PRIMARY KEY, version bigint NOT NULL DEFAULT 0, value text NOT NULL) WITH (fillfactor=90); INSERT INTO pilot_keys(id,value) SELECT n, repeat('x',${manifest.payloadBytes}) FROM generate_series(1,${dataset.rows}) n; GRANT SELECT,UPDATE ON pilot_keys TO pilot_app;`, 120000);
      psql("VACUUM (ANALYZE) pilot_keys", 120000); psql("CHECKPOINT");
      const info = { ...dataset, sizes: JSON.parse(psql("SELECT json_build_object('heapBytes',pg_relation_size('pilot_keys'),'indexBytes',pg_indexes_size('pilot_keys'),'totalBytes',pg_total_relation_size('pilot_keys'),'sharedBuffersBytes',pg_size_bytes(current_setting('shared_buffers')))") ),
        plans: Object.fromEntries(manifest.operations.map((op: string) => [op, psql(`EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS, FORMAT JSON) ${op === "point-read" ? "SELECT value FROM pilot_keys WHERE id=4096" : op === "range-read" ? "SELECT id,value FROM pilot_keys WHERE id>=4096 AND id<4128 ORDER BY id" : `UPDATE pilot_keys SET version=version+1 WHERE id=${op === "hot-update" ? 1 : 4096}`}`)])) };
      record.datasets.push(info); save();
      for (const cell of record.order.filter((c: any) => c.dataset === dataset.id)) {
        if (Date.now() - started + 60000 > manifest.hardStopSeconds * 1000) throw Error("G4 campaign hard stop; remaining cells Unknown");
        const id = `${cell.dataset}-${cell.operation}-${cell.clients}-${cell.repeat}`, gen = `${prefix}-${id}`; names.push(gen);
        const row: any = { ...cell, id, startedAt: new Date().toISOString(), before: snapshot(), status: "running" }; record.windows.push(row); save();
        const bench = `pgbench -n -h ${address} -U pilot_app -d pilot -M prepared -c ${cell.clients} -j 1 -D rows=${dataset.rows} -f /harness/g4-${cell.operation}.sql --random-seed=${manifest.seed + cell.repeat}`;
        docker(["create", "--name", gen, ...limits("generator"), "--network", net, ...mounts, "-e", `PGAPPNAME=g4-${id}`, images.postgres, "sh", "-c",
          `${bench} -T ${manifest.warmupSeconds} > /out/${id}-warmup.log 2>&1 && ${bench} -T ${manifest.observeSeconds} -P 2 -r --failures-detailed -l --sampling-rate=0.01 --log-prefix=/out/${id}-tx; result=$?; cat /sys/fs/cgroup/cpu.stat > /out/${id}-generator-cpu.txt; cat /sys/fs/cgroup/memory.events > /out/${id}-generator-memory.txt; exit $result`]);
        row.actualLimits = docker(["inspect", gen, "--format", '{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.PidsLimit}}']);
        const result = spawnSync("docker", ["start", "-a", gen], { encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
        writeFileSync(resolve(output, `${id}-pgbench.log`), (result.stdout ?? "") + (result.stderr ?? ""));
        row.exit = result.status; row.containerExit = Number(docker(["inspect", gen, "--format", "{{.State.ExitCode}}"]));
        row.status = result.status === 0 && row.containerExit === 0 ? "complete" : "failed";
        row.error = result.error ? String(result.error) : null;
        if (row.status !== "complete") { record.failures.push({ id, error: row.error, exit: row.exit, containerExit: row.containerExit }); docker(["rm", "-f", gen]); }
        row.after = snapshot(); row.endedAt = new Date().toISOString(); save(); docker(["rm", "-f", gen]);
        console.log(`${id}: ${row.status}`);
      }
    }
  } catch (error) { record.failures.push({ reason: String(error) }); process.exitCode = 1; }
  finally {
    try { docker(["stop", "--time", "10", probe]); record.probeExit = Number(docker(["inspect", probe, "--format", "{{.State.ExitCode}}"])); docker(["cp", `${probe}:/out/.`, output], 120000); } catch (e) { record.failures.push({ reason: `raw export: ${e}` }); }
    for (const [name, file] of [[pg, "pg-container.log"], [probe, "probe-container.log"]]) { const logs = spawnSync("docker", ["logs", name!]); writeFileSync(resolve(output, file!), Buffer.concat([logs.stdout ?? Buffer.alloc(0), logs.stderr ?? Buffer.alloc(0)])); }
    for (const name of names.reverse()) { try { docker(["rm", "-f", "-v", name]); } catch {} }
    for (const [kind, name] of [["network", net], ["volume", raw], ["volume", data]]) { try { docker([kind!, "rm", name!]); } catch (e) { record.failures.push({ reason: `cleanup: ${e}` }); } }
    record.endedAt = new Date().toISOString(); save();
  }
  console.log(JSON.stringify({ capture: output, windows: record.windows.length, failures: record.failures }));
}
