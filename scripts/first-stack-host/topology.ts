import { randomUUID } from "node:crypto";
import type { IsolationConnection } from "../../apps/backend/firstStack/isolationConnection";
import { imagePattern } from "../../apps/backend/firstStack/isolationPolicy";

// Disposable local qualification only: no supplied database URL, production
// container name, volume, existing network, or ambient application environment.
export async function topology(control: IsolationConnection, image: string, postgres: string, redis: string) {
  if (![image, postgres, redis].every(v => imagePattern.test(v))) throw Error("Pin all three installed images by ID");
  const name = `infraforge-first-stack-proof-${randomUUID()}`, owned: string[] = [];
  await control.run(["network", "create", "--internal", "--label", `infraforge.first-stack-proof=${name}`, name]);
  const create = async (role: string, source: string, memory: number, cpu: string, args: string[], command: string[]) => {
    const id = await control.run(["create", "--pull=never", "--name", `${name}-${role}`, "--label", `infraforge.first-stack-proof=${name}`,
      "--network", name, "--network-alias", role, `--memory=${memory * 1024 * 1024}`, `--memory-swap=${memory * 1024 * 1024}`,
      `--cpus=${cpu}`, "--pids-limit=256", "--log-driver=local", "--log-opt=max-size=1m", "--log-opt=max-file=1",
      ...args, source, ...command]);
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error("Invalid proof container");
    owned.push(id); await control.run(["start", id]); return id;
  };
  const inspect = async (id: string) => JSON.parse(await control.run(["inspect", id]))[0];
  const port = async (id: string, key: string) => Number((await inspect(id)).NetworkSettings.Ports[key]?.[0]?.HostPort);
  const until = async (check: () => Promise<boolean>, label: string) => {
    const end = Date.now() + 90000;
    while (Date.now() < end) { if (await check()) return; await Bun.sleep(500); }
    throw Error(`Qualification ${label} did not become ready`);
  };
  const close = async () => {
    for (const id of [...owned].reverse()) {
      const v = await inspect(id);
      if (v.Config?.Labels?.["infraforge.first-stack-proof"] !== name) throw Error("Proof cleanup ownership changed");
      await control.run(["rm", "--force", "--volumes", id]);
    }
    await control.run(["network", "rm", name]);
  };
  try {
    const pg = await create("db", postgres, 512, "0.25", ["--env=POSTGRES_HOST_AUTH_METHOD=trust",
      "--env=POSTGRES_DB=infraforge_isolation", "--publish=127.0.0.1::5432"], []);
    const cache = await create("redis", redis, 256, "0.15", [], ["redis-server", "--appendonly", "yes", "--maxmemory", "96mb", "--maxmemory-policy", "noeviction"]);
    await until(async () => { try { await control.run(["exec", pg, "pg_isready", "-U", "postgres"]); return true; } catch { return false; } }, "database");
    const environment = ["--env=NODE_ENV=test", "--env=DATABASE_URL=postgresql://postgres@db:5432/infraforge_isolation",
      "--env=REDIS_HOST=redis", "--env=REDIS_PORT=6379", "--workdir=/app/apps/backend"];
    const migration = await create("migrate", image, 384, "0.5", environment, ["bun", "--no-env-file", "--no-install", "run", "db:migrate"]);
    await until(async () => !(await inspect(migration)).State.Running, "migration");
    if ((await inspect(migration)).State.ExitCode !== 0) throw Error("Disposable migration failed");
    // Migration is stopped before API/worker/executor characterization.
    const api = await create("api", image, 384, "0.35", [...environment, "--publish=127.0.0.1::3000", "--env=PORT=3000",
      "--env=LISTEN_HOST=0.0.0.0", "--env=BETTER_AUTH_URL=http://localhost:3000", "--env=APP_ORIGINS=http://localhost:5173",
      "--env=BETTER_AUTH_SECRET=first-stack-disposable-qualification-only-000000000000"],
    ["bun", "--no-env-file", "--no-install", "executionIdentity/launcher.ts", "api"]);
    const worker = await create("worker", image, 768, "0.5", [...environment, "--env=WORKER_DATABASE_MODE=direct",
      "--env=LISTEN_HOST=0.0.0.0", "--publish=127.0.0.1::3002"],
    ["bun", "--no-env-file", "--no-install", "executionIdentity/launcher.ts", "worker"]);
    const apiUrl = `http://127.0.0.1:${await port(api, "3000/tcp")}`, workerUrl = `http://127.0.0.1:${await port(worker, "3002/tcp")}`;
    await until(async () => { try { return (await fetch(apiUrl + "/health/ready", { signal: AbortSignal.timeout(3000) })).ok &&
      (await fetch(workerUrl + "/health/ready", { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } }, "API/worker");
    return { close, ids: [api, worker, pg, cache], apiUrl, workerUrl,
      databaseUrl: `postgresql://postgres@127.0.0.1:${await port(pg, "5432/tcp")}/infraforge_isolation`,
      configured: { api: { memoryMiB: 384, cpu: 0.35 }, worker: { memoryMiB: 768, cpu: 0.5 },
        database: { memoryMiB: 512, cpu: 0.25 }, redis: { memoryMiB: 256, cpu: 0.15 } },
    };
  } catch (error) { await close(); throw error; }
}
