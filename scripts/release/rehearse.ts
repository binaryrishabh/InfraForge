import { mkdtemp, mkdir, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { ComposeRelease, settingsFingerprint } from "./compose";
import { cancelCommands, command, waitFor } from "./process";
import { releaseSequence, rollbackSequence, type Release } from "./sequence";

const root = fileURLToPath(new URL("../../", import.meta.url));
const image = process.argv[2];
if (!image) throw new Error("Supply the already-built local application image");
if (process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT) throw new Error("Release rehearsal refuses Docker endpoint overrides");
const context = JSON.parse(await command(["docker", "context", "inspect"], root))[0];
if (!/^(npipe:|unix:)/.test(context.Endpoints.docker.Host)) throw new Error("Rehearsal requires a local Docker engine");
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA)$/i.test(key)));
environment.RELEASE_REHEARSAL = "owned-local";
const docker = (args: string[]) => command(["docker", ...args], root, environment);
const builder = await docker(["buildx", "inspect", context.Name]);
if (!/^Driver:\s+docker\s*$/m.test(builder) ||
    !builder.split(/\r?\n/).some((line) => line.startsWith("Endpoint:") && line.slice(9).trim() === context.Name)) {
  throw new Error("Rehearsal builds require the current local Docker context's engine builder");
}
const suffix = randomBytes(4).toString("hex");
const project = `infraforge_release_${suffix}`;
const directory = await mkdtemp(join(tmpdir(), "infraforge-release-"));
const envFile = join(directory, "fixture.env");
const override = join(directory, "compose.yml");
const secondImage = `infraforge-release-fixture:${suffix}`;
const badImage = `infraforge-health-fixture:${suffix}`;
const poolImage = `infraforge-pool-fixture:${suffix}`;
const fixture = resolve(root, "apps/backend/tests/release-fixture.ts").replaceAll("\\", "/");
const proxyFixture = resolve(root, "apps/backend/tests/release-proxy.ts").replaceAll("\\", "/");
let operations: ComposeRelease | undefined;
let cleaning = false;
let accepted: Release | undefined;
let previous: Release | undefined;
const events: string[] = [];
const phase = (value: string) => { events.push(value); console.log(`Release rehearsal: ${value}`); };
const mustFail = async (operation: () => Promise<unknown>, label: string) => {
  try { await operation(); } catch { phase(`${label} rejected`); return; }
  throw new Error(`${label} unexpectedly succeeded`);
};
async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  if (operations) {
    await operations.compose(["down", "--volumes", "--remove-orphans", "--timeout", "5"]);
    const remaining = await docker(["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`]);
    if (remaining) throw new Error("Owned rehearsal containers remain");
    const volumes = await docker(["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`]);
    const networks = await docker(["network", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`]);
    if (volumes || networks) throw new Error("Owned rehearsal volumes/networks remain");
  }
  for (const tag of [secondImage, badImage, poolImage]) {
    try {
      const [record] = JSON.parse(await docker(["image", "inspect", tag]));
      if (record.Config.Labels?.["org.infraforge.rehearsal"] !== suffix) throw new Error("Fixture image ownership mismatch");
      await docker(["image", "rm", tag]);
    } catch (error) { if (!(error as Error).message.startsWith("docker image failed")) throw error; }
  }
  if (!resolve(directory).startsWith(resolve(tmpdir(), "infraforge-release-"))) throw new Error("Unexpected fixture directory");
  await rm(directory, { recursive: true });
}
const interrupt = async () => { await cancelCommands(); await cleanup().finally(() => process.exit(1)); };
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
try {
  const [built] = JSON.parse(await docker(["image", "inspect", image]));
  const metadata = JSON.parse(await docker(["run", "--rm", "--network", "none", image, "cat", "/app/apps/backend/release.json"]));
  const release: Release = { ...metadata, image, imageId: built.Id, settingsFingerprint: "" };
  await mkdir(join(directory, "tls"));
  await mkdir(join(directory, "control"));
  await Bun.write(envFile, `DATABASE_URL=postgresql://postgres@postgres/infraforge_release_${suffix}\nWORKER_DATABASE_URL=postgresql://postgres@postgres/infraforge_release_${suffix}\nMIGRATION_DATABASE_URL=postgresql://postgres@postgres/infraforge_release_${suffix}\nWORKER_DATABASE_MODE=direct\nBETTER_AUTH_SECRET=${randomBytes(32).toString("hex")}\nBETTER_AUTH_URL=https://api.example.invalid\nAPP_ORIGINS=https://app.example.invalid\nAPI_PORT=0\nWS_PORT=0\n`);
  await Bun.write(override, `services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_HOST_AUTH_METHOD: trust
      POSTGRES_DB: infraforge_release_${suffix}
    networks: [application]
    volumes: [fixture_postgres:/var/lib/postgresql/data]
    healthcheck:
      test: [CMD, pg_isready, -U, postgres]
      interval: 1s
      timeout: 2s
      retries: 30
  migration:
    environment:
      RELEASE_REHEARSAL: owned-local
    volumes:
      - "${fixture}:/app/apps/backend/tests/release-fixture.ts:ro"
  api:
    environment:
      RELEASE_REHEARSAL: owned-local
    volumes:
      - "${proxyFixture}:/app/apps/backend/tests/release-proxy.ts:ro"
      - "${join(directory, "tls").replaceAll("\\", "/")}:/fixture/tls:ro"
  redis:
    image: redis:8-alpine
  pool-transaction:
    image: ${poolImage}
    networks: [application]
    volumes: ["${join(directory, "transaction.ini").replaceAll("\\", "/")}:/etc/pgbouncer.ini:ro"]
  pool-session:
    image: ${poolImage}
    networks: [application]
    volumes: ["${join(directory, "session.ini").replaceAll("\\", "/")}:/etc/pgbouncer.ini:ro"]
  proxy:
    image: ${poolImage}
    user: "0:0"
    command: [nginx, -g, "daemon off;"]
    networks: [application]
    volumes:
      - "${join(directory, "nginx.conf").replaceAll("\\", "/")}:/etc/nginx/nginx.conf:ro"
      - "${join(directory, "tls").replaceAll("\\", "/")}:/fixture/tls:ro"
      - "${join(directory, "control").replaceAll("\\", "/")}:/fixture/control:ro"
volumes:
  fixture_postgres:
`);
  operations = new ComposeRelease(root, envFile, project, release, async (current, prior) => { accepted = current; previous = prior; }, override, 25000, environment);
  release.settingsFingerprint = settingsFingerprint(await operations.config());
  const helper = operations.compose(["run", "--rm", "--no-deps", "migration", "bun", "-e", "setTimeout(()=>{},60000)"])
    .then(() => false, () => true);
  const helperIds = (running = false) => docker(["ps", running ? "-q" : "-aq", "--filter", `label=com.docker.compose.project=${project}`,
    "--filter", "label=com.docker.compose.service=migration"]);
  await waitFor(async () => Boolean(await helperIds(true)), 15000);
  await cancelCommands();
  if (!await helper) throw new Error("Interrupted migration CLI unexpectedly succeeded");
  await operations.stopMigration();
  await waitFor(async () => !await helperIds(), 10000);
  phase("interrupted migration CLI and owned helper cleanup passed");
  await operations.compose(["up", "-d", "postgres", "redis"]);
  await waitFor(async () => {
    const id = await operations!.compose(["ps", "-q", "postgres"]);
    return JSON.parse(await docker(["inspect", id]))[0].State.Health.Status === "healthy";
  });
  const fixtureCommand = (action: string) => operations!.compose(["run", "--rm", "--no-deps", "migration", "bun", "tests/release-fixture.ts", action]);
  await fixtureCommand("legacy");
  phase("legacy eight-migration database prepared");
  await operations.compose(["exec", "-T", "postgres", "pg_dump", "-U", "postgres", "-d", `infraforge_release_${suffix}`, "-Fc", "-f", "/tmp/pre-release.dump"]);
  await operations.compose(["exec", "-T", "postgres", "createdb", "-U", "postgres", `infraforge_restore_${suffix}`]);
  await operations.compose(["exec", "-T", "postgres", "pg_restore", "-U", "postgres", "--exit-on-error", "--no-owner", "-d", `infraforge_restore_${suffix}`, "/tmp/pre-release.dump"]);
  const restored = await operations.compose(["exec", "-T", "postgres", "psql", "-U", "postgres", "-d", `infraforge_restore_${suffix}`, "-Atc", 'SELECT "userId" FROM "Infrastructure" WHERE id=\'legacy\'']);
  if (restored !== "historical-owner") throw new Error("Disposable backup restore did not preserve legacy data");
  phase("real PostgreSQL custom backup restored into a separate disposable database");
  await fixtureCommand("migration-conflict");
  await mustFail(() => releaseSequence(operations!, release), "actual Prisma migration failure");
  if (await operations.compose(["ps", "--status", "running", "-q", "api", "worker", "ws-server"])) throw new Error("Migration failure started application");
  await fixtureCommand("clear-migration-conflict");
  await releaseSequence(operations, release);
  await fixtureCommand("check-legacy");
  phase("additive migration, postchecks, three readiness probes and legacy quarantine passed");
  await mustFail(() => operations!.compose(["run", "--rm", "--no-deps", "worker"]), "duplicate worker");
  await mustFail(() => operations!.migrate(), "migration while worker owns database");
  await fixtureCommand("active");
  await mustFail(() => operations!.preflight(), "active-run release");
  await fixtureCommand("clear-active");
  await operations.stop();
  await fixtureCommand("failed-history");
  await mustFail(() => operations!.migrate(), "failed migration history");
  await mustFail(() => operations!.compose(["run", "--rm", "--no-deps", "worker"]), "worker against incompatible migration history");
  await fixtureCommand("clear-failed");
  await fixtureCommand("drift");
  await mustFail(() => operations!.postcheck(), "schema drift");
  await fixtureCommand("clear-drift");
  await fixtureCommand("disable-guard");
  await mustFail(() => operations!.postcheck(), "missing SQL guard");
  await fixtureCommand("enable-guard");
  await operations.postcheck();
  // A distinct, explicitly labelled test image exercises exact-image rollback.
  const next = { ...release, sha: "c".repeat(40), image: secondImage };
  await Bun.write(join(directory, "release.json"), JSON.stringify({ ...metadata, sha: next.sha }));
  await Bun.write(join(directory, "Dockerfile"), `FROM ${image}\nLABEL org.infraforge.rehearsal="${suffix}" org.opencontainers.image.revision="${next.sha}"\nCOPY release.json /app/apps/backend/release.json\n`);
  await docker(["build", "--builder", context.Name, "-t", secondImage, directory]);
  next.imageId = JSON.parse(await docker(["image", "inspect", secondImage]))[0].Id;
  await releaseSequence(operations, next, release);
  await rollbackSequence(operations, next, release);
  if (accepted?.sha !== release.sha || previous?.sha !== next.sha) throw new Error("Rollback acceptance state mismatch");
  phase("exact image/SHA upgrade and same-schema container rollback passed");
  const bad = { ...release, sha: "d".repeat(40), image: badImage };
  await Bun.write(join(directory, "release.json"), JSON.stringify({ ...metadata, sha: bad.sha }));
  await Bun.write(join(directory, "probe.ts"), "process.exit(1);\n");
  await Bun.write(join(directory, "Dockerfile"), `FROM ${image}\nLABEL org.infraforge.rehearsal="${suffix}" org.opencontainers.image.revision="${bad.sha}"\nCOPY release.json /app/apps/backend/release.json\nCOPY probe.ts /app/apps/backend/health/probe.ts\n`);
  await docker(["build", "--builder", context.Name, "-t", badImage, directory]);
  bad.imageId = JSON.parse(await docker(["image", "inspect", badImage]))[0].Id;
  await mustFail(() => releaseSequence(operations!, bad, release), "actual unhealthy container release");
  await operations.ready(release);
  phase("failed health gate restored the accepted image");
  await operations.compose(["stop", "redis"]);
  await mustFail(() => operations!.compose(["exec", "-T", "api", "bun", "health/probe.ts", "3000"]), "API with unavailable Redis");
  await mustFail(() => operations!.compose(["exec", "-T", "ws-server", "bun", "health/probe.ts", "3001"]), "WS with unavailable Redis");
  await mustFail(() => operations!.compose(["exec", "-T", "worker", "bun", "health/probe.ts", "3002"]), "worker with unavailable Redis");
  await operations.stop();
  await operations.compose(["up", "-d", "redis"]);
  await operations.start(release);
  await operations.ready(release);
  await operations.stop();
  await Bun.write(join(directory, "Dockerfile"), `FROM alpine:3.22\nRUN apk add --no-cache pgbouncer=1.24.0-r0 nginx openssl\nLABEL org.infraforge.rehearsal="${suffix}"\nUSER nobody\nCMD ["pgbouncer", "/etc/pgbouncer.ini"]\n`);
  await docker(["build", "--builder", context.Name, "-t", poolImage, directory]);
  for (const mode of ["transaction", "session"]) {
    await Bun.write(join(directory, `${mode}.ini`), `[databases]\ninfraforge_release_${suffix} = host=postgres port=5432 dbname=infraforge_release_${suffix} user=postgres\n[pgbouncer]\nlisten_addr=0.0.0.0\nlisten_port=6432\nauth_type=any\npool_mode=${mode}\ndefault_pool_size=${mode === "transaction" ? 1 : 5}\nmax_client_conn=20\npidfile=/tmp/pgbouncer.pid\n`);
  }
  await operations.compose(["up", "-d", "pool-transaction", "pool-session"]);
  const probe = (mode: string) => operations!.compose(["run", "--rm", "--no-deps", "-e", `DATABASE_URL=postgresql://postgres@pool-${mode}:6432/infraforge_release_${suffix}`,
    "worker", "bun", "-e", 'import {verifyWorkerSession} from "./infra/workerConnection"; await verifyWorkerSession(process.env.DATABASE_URL);']);
  await waitFor(async () => { try { await probe("session"); return true; } catch { return false; } }, 20000);
  await mustFail(() => probe("transaction"), "real transaction pooler");
  phase("real session pooler accepted; transaction pooler rejected");
  await docker(["run", "--rm", "--network", "none", "--user", "0:0", "-v", `${join(directory, "tls")}:/fixture/tls`, poolImage,
    "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=proxy",
    "-addext", "subjectAltName=DNS:proxy,DNS:api.example.invalid", "-keyout", "/fixture/tls/key.pem", "-out", "/fixture/tls/cert.pem"]);
  const proxy = (await readFile(resolve(root, "ops/nginx.conf.template"), "utf8")).replaceAll("DOMAIN", "api.example.invalid")
    .replace("listen 80;", "listen 8080;").replace("listen 443 ssl;", "listen 8443 ssl;")
    .replaceAll("/etc/infraforge/tls/fullchain.pem", "/fixture/tls/cert.pem").replaceAll("/etc/infraforge/tls/privkey.pem", "/fixture/tls/key.pem")
    .replaceAll("127.0.0.1:3000", "api:3000").replaceAll("127.0.0.1:3001", "ws-server:3001")
    .replaceAll("/var/lib/infraforge/releases/maintenance", "/fixture/control/maintenance");
  await Bun.write(join(directory, "nginx.conf"), `events {}\nhttp {\n${proxy}\n}`);
  await operations.start(release);
  await operations.ready(release);
  await operations.compose(["up", "-d", "proxy"]);
  await waitFor(async () => { try {
    await operations!.compose(["exec", "-T", "proxy", "nginx", "-t"]); return true;
  } catch { return false; } }, 15000);
  await Bun.write(join(directory, "control", "maintenance"), "fixture\n");
  await operations.compose(["exec", "-T", "api", "bun", "-e", 'const r=await fetch("https://proxy:8443/api/auth/providers",{tls:{ca:await Bun.file("/fixture/tls/cert.pem").text()}}); if(r.status!==503||r.headers.get("X-InfraForge-Maintenance")!=="true")process.exit(1);']);
  await unlink(join(directory, "control", "maintenance"));
  await operations.compose(["exec", "-T", "api", "bun", "tests/release-proxy.ts"]);
  phase("TLS proxy maintenance, real Secure sessions, authenticated WS, revocation and Origin checks passed");
  await operations.compose(["stop", "postgres"]);
  await mustFail(() => operations!.compose(["exec", "-T", "api", "bun", "health/probe.ts", "3000"]), "API with unavailable PostgreSQL");
  await mustFail(() => operations!.compose(["exec", "-T", "ws-server", "bun", "health/probe.ts", "3001"]), "WS with unavailable PostgreSQL");
  await waitFor(async () => {
    const id = await operations!.compose(["ps", "-aq", "worker"]);
    const [worker] = JSON.parse(await docker(["inspect", id]));
    return worker.RestartCount > 0 || (worker.State.Status === "exited" && worker.State.ExitCode !== 0);
  }, 20000);
  phase("PostgreSQL loss fails closed; worker ownership loss stops worker");
  await cleanup();
  phase("owned containers, volumes, networks, fixture images and temporary files removed");
  console.log(JSON.stringify({ success: true, events }));
} catch (error) {
  console.error(error);
  if (operations) console.error(await operations.compose(["logs", "--tail", "20"]).catch(() => "Fixture diagnostics unavailable"));
  throw error;
} finally { await cleanup(); }
