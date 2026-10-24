// Subprocess fixture: exercise the actual CLI, filesystem state and release
// sequence; replace all external commands and public HTTP with synthetic peers.
import { spyOn } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import * as processTools from "../../release/process";
import * as build from "../../release/build";
import { settingsFingerprint } from "../../release/compose";

const mode = process.argv[2];
const sha = "a".repeat(40), imageId = `sha256:${"b".repeat(64)}`;
const metadata = { sha, migrationFingerprint: "schema", authContract: 1 };
const events: string[][] = [];
let running = false;
const services = ["api", "worker", "ws-server"];
const config = (host: string) => ({ services: Object.fromEntries([...services, "migration"].map(service => [service, {
  image: imageId, environment: { DATABASE_URL: `postgresql://fixture:synthetic@${host}/app?sslmode=verify-full`,
    API_DATABASE_URL: `postgresql://fixture:synthetic@${host}/app?sslmode=verify-full`,
    WORKER_DATABASE_URL: `postgresql://fixture:synthetic@${host}/app?sslmode=verify-full`, BETTER_AUTH_URL: "https://api.example.invalid" },
}])) });
const current = { ...metadata, image: `infraforge-backend:${sha}`, imageId, settingsFingerprint: settingsFingerprint(config("old.example.invalid")) };
await mkdir(".agent", { recursive: true });
const directory = await mkdtemp(resolve(".agent", "reconfigure-test-"));
try {
  await Bun.write(resolve(directory, "accepted.json"), JSON.stringify({ current }));
  spyOn(build, "buildReleaseImage").mockImplementation(async () => { throw new Error("Unexpected rebuild"); });
  spyOn(processTools, "waitFor").mockImplementation(async check => { if (!await check()) throw new Error("fixture readiness failed"); });
  spyOn(processTools, "command").mockImplementation(async args => {
    events.push(args);
    if (args[0] === "git") {
      if (args[1] === "status") return "";
      return args[1] === "ls-remote" && mode === "wrong-main" ? "c".repeat(40) : sha;
    }
    if (args[1] === "image") return JSON.stringify([{ Id: imageId, Config: { Labels: {
      "org.opencontainers.image.revision": sha, "org.opencontainers.image.source": "https://github.com/binaryrishabh/InfraForge",
    } } }]);
    if (args[1] === "run") return JSON.stringify(metadata);
    if (args[1] === "inspect") return JSON.stringify(services.map(service => ({ Image: imageId, Name: service,
      Config: { Labels: { "com.docker.compose.project": "infraforge", "com.docker.compose.service": service } },
      State: { Running: running, Restarting: false, Status: running ? "running" : "exited", Health: { Status: "healthy" } },
    })));
    if (args[1] === "ps") return ""; // stopMigration: no helper survives.
    if (args[1] !== "compose") throw new Error("Unexpected command");
    if (args.includes("config")) {
      const next = config("new.example.invalid");
      if (mode === "database-start-failure") {
        for (const service of Object.values(next.services)) {
          for (const key of ["DATABASE_URL", "API_DATABASE_URL", "WORKER_DATABASE_URL"] as const) {
            service.environment[key] = "postgresql://fixture:synthetic@postgres/app";
          }
        }
        Object.assign(next.services, { postgres: { image: "postgres:pinned", environment: { POSTGRES_PASSWORD: "synthetic" } } });
      }
      return JSON.stringify(next);
    }
    if (args.includes("ps") && args.at(-1) === "postgres") return "";
    if (args.includes("--wait") && mode === "database-start-failure") throw new Error("database startup failed");
    if (args.includes("preflight") && mode === "active") throw new Error("active run");
    if (args.includes("migrate") && mode === "migration-failure") throw new Error("migration failed");
    if (args.includes("up") && args.includes("api")) running = true;
    if (args.includes("stop")) running = false;
    if (args.includes("ps")) return "api worker ws-server";
    if (args.includes("health/probe.ts") && mode === "readiness-failure") throw new Error("unhealthy");
    return "";
  });
  globalThis.fetch = (async (url: string | URL | Request) => mode === "proxy-failure" ? new Response(null, { status: 200 }) : String(url).endsWith("/health/ready")
    ? Response.json({ success: true, release: { sha } })
    : new Response(null, { status: 503, headers: { "X-InfraForge-Maintenance": "true" } })) as typeof fetch;
  process.argv = [process.execPath, "scripts/release.ts", "reconfigure", sha, resolve(directory, "synthetic-config"), directory];
  let failure = "";
  try { await import("../../release.ts"); } catch (error) { failure = (error as Error).message; }
  console.log(JSON.stringify({ failure, events, current,
    accepted: JSON.parse(await readFile(resolve(directory, "accepted.json"), "utf8")),
    maintenance: await Bun.file(resolve(directory, "maintenance")).exists(), lock: await Bun.file(resolve(directory, "release.lock")).exists() }));
} finally { await rm(directory, { recursive: true }); }
