import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import Redis from "ioredis";

export interface LocalSettings {
  databaseUrl: string;
  databaseName: string;
  redisPort: number;
  apiPort: number;
}

export function readLocalSettings(env: Record<string, string | undefined>): LocalSettings {
  if (env.INTEGRATION_DISPOSABLE !== "local-only") {
    throw new Error("Explicit disposable local service acknowledgement is required");
  }
  if (Object.keys(env).some((name) => name.startsWith("PG"))) {
    throw new Error("Ambient PostgreSQL settings must be absent from the test shell");
  }
  let url: URL;
  try { url = new URL(env.INTEGRATION_DATABASE_URL ?? ""); }
  catch { throw new Error("An explicit disposable PostgreSQL URL is required"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.username || url.search || url.hash) {
    throw new Error("PostgreSQL must use loopback with no URL options");
  }
  const databaseName = url.pathname.slice(1);
  if (!/^infraforge_it_[a-f0-9]{8,64}$/.test(databaseName)) {
    throw new Error("PostgreSQL database name must be infraforge_it_<8+ hex characters>");
  }
  const port = (value: string | undefined, fallback?: number) => {
    const result = value === undefined ? fallback : Number(value);
    if (result === undefined || !Number.isInteger(result) || result < 1024 || result > 65535) {
      throw new Error("Explicit valid local service ports are required");
    }
    return result;
  };
  const redisPort = port(env.INTEGRATION_REDIS_PORT);
  const apiPort = port(env.INTEGRATION_API_PORT, 3100);
  if (redisPort === 6379 || redisPort === 3001 || redisPort === apiPort || apiPort === 3001 ||
      (apiPort === 3000 && env.INTEGRATION_ALLOW_API_3000 !== "yes")) {
    throw new Error("Service ports must be distinct; development ports require isolation");
  }
  return { databaseUrl: url.toString(), databaseName, redisPort, apiPort };
}

export function childEnvironment(settings: LocalSettings, inherited: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "TEMP", "TMP", "TMPDIR"]) {
    if (inherited[name] !== undefined) env[name] = inherited[name];
  }
  return { ...env, NODE_ENV: "test", DATABASE_URL: settings.databaseUrl,
    PORT: String(settings.apiPort), REDIS_HOST: "127.0.0.1", REDIS_PORT: String(settings.redisPort),
    DOTENV_CONFIG_PATH: join(tmpdir(), `infraforge-no-env-${randomUUID()}`), DOTENV_CONFIG_OVERRIDE: "false" };
}

export async function until<T>(read: () => Promise<T | undefined | false>, label: string, timeout = 20000, pollMs = 50): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined && value !== false) return value;
    await Bun.sleep(pollMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function assertPortFree(port: number) {
  const occupied = await new Promise<boolean>((resolve) => {
    const socket = connect({ host: "localhost", port });
    socket.setTimeout(500);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.once("timeout", () => { socket.destroy(); resolve(true); });
  });
  if (occupied) throw new Error(`Required local port ${port} is occupied or unavailable`);
}

export class LocalHarness {
  readonly sql: Pool;
  readonly redis: Redis;
  readonly api: string;
  private children = new Map<string, ReturnType<typeof Bun.spawn>>();
  private diagnostics = new Map<string, string>();
  private processRecords: Array<{ name: string; pid: number; startedAt: string; endedAt?: string; killedByHarness?: boolean;
    exitCodeBeforeStop?: number | null; signalCodeBeforeStop?: string | null;
    exitCode?: number | null; signalCode?: string | null }> = [];
  private serviceChecks: Array<{ phase: string; timestamp: string; redisResponse: string }> = [];
  private readonly cwd = fileURLToPath(new URL("../../", import.meta.url));

  constructor(readonly settings: LocalSettings) {
    this.sql = new Pool({ connectionString: settings.databaseUrl, ssl: false, options: "",
      password: decodeURIComponent(new URL(settings.databaseUrl).password), connectionTimeoutMillis: 3000 });
    this.redis = new Redis({ host: "127.0.0.1", port: settings.redisPort, lazyConnect: true, retryStrategy: () => null });
    this.redis.on("error", () => {});
    this.api = `http://localhost:${settings.apiPort}/api`;
  }

  private redact(text: string) {
    const password = new URL(this.settings.databaseUrl).password;
    return text.replaceAll(this.settings.databaseUrl, "[database URL]")
      .replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[database URL]")
      .replaceAll(password || "\0", "[redacted]");
  }

  private spawn(name: string, args: string[]) {
    if (this.children.has(name)) throw new Error(`Process ${name} is already registered`);
    const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install", ...args], {
      cwd: this.cwd,
      env: childEnvironment(this.settings, process.env),
      stdout: "pipe", stderr: "pipe",
    });
    this.children.set(name, child);
    const record = { name, pid: child.pid, startedAt: new Date().toISOString() };
    this.processRecords.push(record);
    void child.exited.then(() => {
      const completed = this.processRecords.findLast((item) => item.pid === child.pid);
      if (completed) { completed.endedAt = new Date().toISOString(); completed.exitCode = child.exitCode; completed.signalCode = child.signalCode; }
    });
    for (const stream of [child.stdout, child.stderr]) {
      void (async () => {
        for await (const chunk of stream as ReadableStream<Uint8Array>) {
          const previous = this.diagnostics.get(name) ?? "";
          this.diagnostics.set(name, (previous + this.redact(new TextDecoder().decode(chunk))).slice(-12000));
        }
      })();
    }
    return child;
  }

  async prepare() {
    await assertPortFree(this.settings.apiPort);
    await assertPortFree(3001);
    const database = await this.sql.query("SELECT current_database() AS name");
    if (database.rows[0]?.name !== this.settings.databaseName) throw new Error("Database identity mismatch");
    const contents = await this.sql.query(`SELECT nspname FROM pg_namespace
      WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('public', 'information_schema')
      UNION ALL SELECT schemaname FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')`);
    if (contents.rowCount !== 0) throw new Error("Disposable PostgreSQL database must start empty");
    await this.redis.connect();
    await this.checkRedis("preflight");
    if (await this.redis.dbsize() !== 0 || (await this.redis.pubsub("CHANNELS") as string[]).length !== 0) {
      throw new Error("Dedicated Redis must start empty with no Pub/Sub channels");
    }
    const migration = this.spawn("migration", ["run", "db:migrate"]);
    const result = await until(async () => migration.exitCode === null ? undefined : migration.exitCode, "migration completion", 60000);
    const record = this.processRecords.findLast((item) => item.pid === migration.pid);
    if (record) { record.exitCode = result; record.signalCode = migration.signalCode; }
    this.children.delete("migration");
    if (result !== 0) throw new Error(`Disposable migration failed: ${this.diagnostics.get("migration")}`);
    this.spawn("api", ["run", "index.ts"]);
    this.spawn("ws", ["run", "ws-server.ts"]);
    await until(async () => {
      try { return (await fetch(`http://localhost:${this.settings.apiPort}/health`)).ok || undefined; }
      catch { return undefined; }
    }, "API health");
    await until(async () => {
      try { return (await fetch("http://localhost:3001")).ok || undefined; }
      catch { return undefined; }
    }, "WebSocket HTTP handshake");
  }

  private async checkRedis(phase: string) {
    const response = await this.redis.ping();
    this.serviceChecks.push({ phase, timestamp: new Date().toISOString(), redisResponse: response });
    if (response !== "PONG") throw new Error("Dedicated Redis readiness check failed");
  }

  async startWorker() {
    await this.checkRedis("before-worker-start");
    this.spawn("worker", ["run", "worker.ts"]);
  }

  async stop(name: string) {
    const child = this.children.get(name);
    if (!child) return;
    const record = this.processRecords.findLast((item) => item.pid === child.pid);
    if (record) { record.exitCodeBeforeStop = child.exitCode; record.signalCodeBeforeStop = child.signalCode; }
    if (child.exitCode === null && child.signalCode === null) {
      if (record) record.killedByHarness = true;
      child.kill("SIGKILL");
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([child.exited, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out stopping ${name}`)), 5000);
      })]);
    } finally { clearTimeout(timer); }
    if (record) { record.exitCode = child.exitCode; record.signalCode = child.signalCode; }
    this.children.delete(name);
  }

  async request(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", status = 200): Promise<any> {
    const response = await fetch(this.api + path, { method, headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    if (response.status !== status) throw new Error(`HTTP ${method} ${path} returned ${response.status}, expected ${status}`);
    return data;
  }

  logs() { return Object.fromEntries(this.diagnostics); }
  processes() { return this.processRecords; }
  checks() { return this.serviceChecks; }

  async close() {
    const failures: string[] = [];
    for (const name of [...this.children.keys()].reverse()) {
      try { await this.stop(name); } catch { failures.push(`Could not stop ${name}`); }
    }
    this.redis.disconnect();
    await this.sql.end();
    if (failures.length) throw new Error(failures.join("; "));
  }
}
