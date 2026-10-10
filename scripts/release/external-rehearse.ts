import { mkdtemp, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { productionIdentity, neonMetadata, rehearsalTarget, rehearsalWorkspace } from "./neon";
import { ComposeRelease, settingsFingerprint, verifyImage } from "./compose";
import { releaseSequence, type Release } from "./sequence";
import { command, cancelCommands, waitFor } from "./process";
import { proveCutoverDatabase } from "./cutover-proof";
import { proveWorkerRecovery } from "./worker-recovery";
import { retirementRequest } from "../../apps/backend/cutover/retire";
import { safeFailure, CutoverError } from "../../apps/backend/cutover/database";

const root = fileURLToPath(new URL("../../", import.meta.url));
const image = process.argv[2];
let directory: string | undefined;
let operations: ComposeRelease | undefined;
let cleaning: Promise<void> | undefined;
const cleanup = () => cleaning ??= (async () => {
  if (operations) {
    await operations.stopMigration();
    await operations.compose(["down", "--volumes", "--remove-orphans", "--timeout", "10"]);
    for (const kind of ["ps", "volume", "network"]) {
      const args = kind === "ps" ? ["ps", "-aq"] : [kind, "ls", "-q"];
      if (await command(["docker", ...args, "--filter", `label=com.docker.compose.project=${operations.project}`], root, operations.environment)) {
        throw new CutoverError("Owned rehearsal resources remain; retain temporary configuration for cleanup");
      }
    }
  }
  if (directory) {
    if (!resolve(directory).startsWith(resolve(tmpdir(), "infraforge-neon-rehearsal-"))) throw new CutoverError("Invalid cleanup directory");
    await rm(directory, { recursive: true });
  }
})();
const interrupt = async () => { await cancelCommands(); await cleanup().finally(() => process.exit(1)); };
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
try {
  if (!image || process.argv.length !== 3) throw new CutoverError("Supply one verified local application image");
  if (process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT) throw new CutoverError("Remote Docker overrides are forbidden");
  const context = JSON.parse(await command(["docker", "context", "inspect"], root))[0];
  if (!/^(npipe:|unix:)/.test(context.Endpoints.docker.Host)) throw new CutoverError("A local Docker engine is required");
  const production = await productionIdentity(process.env.REHEARSAL_PRODUCTION_IDENTITY_FILE, root);
  const verifyTarget = async () => { rehearsalTarget(process.env, production, await neonMetadata(process.env, production)); };
  const target = rehearsalTarget(process.env, production, await neonMetadata(process.env, production));
  console.log(JSON.stringify({ target: target.display, productionRefused: true, noHostedSettingsChanged: true }));
  if (!process.env.REHEARSAL_IDS_FILE) throw new CutoverError("Explicit rehearsal deployment IDs file required");
  const request = retirementRequest(JSON.parse(await readFile(process.env.REHEARSAL_IDS_FILE, "utf8")),
    process.env.REHEARSAL_FENCE_ACK, process.env.REHEARSAL_FENCE_EVIDENCE);
  if (request.ids.length !== 4) throw new CutoverError("This cutover rehearsal expects exactly four explicitly selected legacy live runs");
  const environment: Record<string, string | undefined> = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA)$/i.test(key)));
  environment.DOCKER_CONTEXT = context.Name;
  const suffix = randomBytes(4).toString("hex");
  const project = `infraforge_rehearsal_${suffix}`;
  Object.assign(environment, { RELEASE_REHEARSAL: "verified-neon", DATABASE_URL: target.urls[0], MIGRATION_DATABASE_URL: target.urls[1],
    WORKER_DATABASE_URL: target.urls[2], WORKER_DATABASE_MODE: "direct", BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    BETTER_AUTH_URL: "https://api.example.invalid", APP_ORIGINS: "https://app.example.invalid", API_PORT: "0", WS_PORT: "0" });
  const direct = new URL(target.urls[1]!);
  Object.assign(environment, { BACKUP_HOST: direct.hostname, BACKUP_USER: decodeURIComponent(direct.username),
    BACKUP_PASSWORD: decodeURIComponent(direct.password), BACKUP_DATABASE: target.database });
  rehearsalWorkspace(project, join(tmpdir(), `infraforge-neon-rehearsal-${suffix}`));
  directory = await mkdtemp(join(tmpdir(), "infraforge-neon-rehearsal-"));
  rehearsalWorkspace(project, directory);
  await chmod(directory, 0o700);
  const envFile = join(directory, "empty.env");
  await Bun.write(envFile, "");
  const override = join(directory, "compose.yml");
  const fixture = resolve(root, "apps/backend/tests/release-ownership.ts").replaceAll("\\", "/");
  await Bun.write(override, `services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_HOST_AUTH_METHOD: trust
      POSTGRES_DB: infraforge_reference_${suffix}
    ports: ["127.0.0.1:0:5432"]
    # The reference/restore databases are disposable and reachable only through loopback.
    networks: [application, egress]
    volumes: [reference_data:/var/lib/postgresql]
  tools:
    image: postgres:18-alpine
    profiles: [release]
    networks: [egress]
    environment:
      PGHOST: \${BACKUP_HOST}
      PGUSER: \${BACKUP_USER}
      PGPASSWORD: \${BACKUP_PASSWORD}
      PGDATABASE: \${BACKUP_DATABASE}
      PGSSLMODE: verify-full
      PGSSLROOTCERT: system
    volumes: ["${directory.replaceAll("\\", "/") }:/proof"]
  api:
    environment:
      RELEASE_REHEARSAL: verified-neon
    volumes: ["${fixture}:/app/apps/backend/tests/release-ownership.ts:ro"]
  worker:
    restart: "no"
volumes:
  reference_data:
`);
  const [built] = JSON.parse(await command(["docker", "image", "inspect", image], root, environment));
  const metadata = JSON.parse(await command(["docker", "run", "--rm", "--network", "none", image, "cat", "/app/apps/backend/release.json"], root, environment));
  const release: Release = { ...metadata, image, imageId: built.Id, settingsFingerprint: "" };
  await verifyImage(release, root, environment);
  class VerifiedRehearsal extends ComposeRelease {
    override async migrate() { await verifyTarget(); await super.migrate(); }
    override async start(value: Release) { await verifyTarget(); await super.start(value); }
  }
  operations = new VerifiedRehearsal(root, envFile, project, release, async () => {}, override, 90000, environment);
  release.settingsFingerprint = settingsFingerprint(await operations.config());
  await operations.compose(["up", "-d", "postgres", "redis"]);
  await waitFor(async () => { try { await operations!.compose(["exec", "-T", "postgres", "pg_isready", "-U", "postgres"]); return true; } catch { return false; } });
  const address = await operations.compose(["port", "postgres", "5432"]);
  if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new CutoverError("Unexpected reference PostgreSQL listener");
  await operations.compose(["exec", "-T", "postgres", "createdb", "-U", "postgres", `infraforge_restore_${suffix}`]);
  const archive = join(directory, "pre-release.dump");
  const proof = await proveCutoverDatabase({ root, directory, environment, source: target.urls[1]!,
    reference: `postgresql://postgres@${address}/infraforge_reference_${suffix}`,
    restore: `postgresql://postgres@${address}/infraforge_restore_${suffix}`, archive, request, verifyTarget,
    dump: async () => {
      const version = await operations!.compose(["run", "--rm", "--no-deps", "tools", "pg_dump", "--version"]);
      if (!/PostgreSQL\) 18\./.test(version)) throw new CutoverError("PostgreSQL 18 dump tools required");
      await operations!.compose(["run", "--rm", "--no-deps", "tools", "pg_dump", "--format=custom", "--file=/proof/pre-release.dump"]);
      await chmod(archive, 0o600);
    }, restoreDump: async () => {
      const id = await operations!.compose(["ps", "-q", "postgres"]);
      await command(["docker", "cp", archive, `${id}:/tmp/pre-release.dump`], root, environment);
      await operations!.compose(["exec", "-T", "postgres", "pg_restore", "-U", "postgres", "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", "-d", `infraforge_restore_${suffix}`, "/tmp/pre-release.dump"]);
    } });
  console.log(JSON.stringify({ databaseProof: proof }));
  await releaseSequence(operations, release);
  console.log(await operations.compose(["exec", "-T", "api", "bun", "tests/release-ownership.ts"]));
  let refused = false;
  try { await operations.compose(["run", "--rm", "--no-deps", "worker"]); } catch { refused = true; }
  if (!refused) throw new CutoverError("Duplicate worker was accepted");
  const pooled = new URL(target.urls[2]!); pooled.hostname = pooled.hostname.replace(/(?=\.)/, "-pooler");
  // Known Neon transaction endpoint rejection happens before opening a connection.
  const refusal = await command(["docker", "compose", "--project-name", project, "--env-file", envFile,
    "-f", "apps/backend/docker-compose.yml", "-f", override, "run", "--rm", "--no-deps", "-e", "DATABASE_URL", "worker",
    "bun", "-e", 'import {workerDatabaseUrl} from "./infra/workerConnection"; try { workerDatabaseUrl(process.env); } catch (error) { if(!error.message.includes("transaction pooling is unsupported")) process.exit(1); console.log("POOLER_REFUSED"); process.exit(0); } process.exit(1);'],
    root, { ...environment, RELEASE_SHA: release.sha, RELEASE_IMAGE: image, DATABASE_URL: pooled.href });
  if (refusal !== "POOLER_REFUSED") throw new CutoverError("Neon pooler worker rejection was not established");
  const recovery = await proveWorkerRecovery(operations, release, target.urls[2]!);
  await operations.ready(release);
  console.log(JSON.stringify({ result: "PASS", workerRecovery: recovery, directWorker: true, pooledWorkerRefused: true, readiness: "PASS",
    hostedOAuthAndProxy: "NOT_TESTED", branchRetainedForOperatorDeletion: true }));
} catch (error) { console.error(JSON.stringify({ result: "FAIL", error: safeFailure(error) })); process.exitCode = 1; }
finally {
  try { await cleanup(); console.log(JSON.stringify({ ownedLocalResourcesRemoved: true })); }
  catch { console.error(JSON.stringify({ cleanup: "FAIL", temporaryConfigurationRetained: true })); process.exitCode = 1; }
}
