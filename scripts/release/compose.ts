import { createHash } from "node:crypto";
import { command, waitFor } from "./process";
import type { Release, ReleaseOperations } from "./sequence";
import { postgresUrl } from "../../apps/backend/utils/postgresUrl";

const services = ["api", "worker", "ws-server"];
type ContainerState = { Name: string; Config: { Labels: Record<string, string> };
  State: { Status: string; Running: boolean; Restarting: boolean } };

export function applicationStopBlockers(records: ContainerState[], project: string) {
  return records.flatMap((record) => {
    if (record.Config.Labels["com.docker.compose.project"] !== project ||
        !services.includes(record.Config.Labels["com.docker.compose.service"] ?? "")) throw new Error("Application container ownership mismatch");
    return !record.State.Running && !record.State.Restarting && ["created", "exited", "dead"].includes(record.State.Status)
      ? [] : [`${record.Name}: ${record.State.Status}`];
  });
}
// Services a release starts plus everything they transitively depend on (for example Redis).
export function releaseDependencyClosure(declared: Record<string, { depends_on?: Record<string, unknown>; environment?: Record<string, string> }>, roots: readonly string[]) {
  const needed = new Set<string>(), pending = [...roots];
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (needed.has(name) || !declared[name]) continue;
    needed.add(name);
    pending.push(...Object.keys(declared[name]!.depends_on ?? {}));
    // This dependency is selected by URL, so remote providers need no local DB
    // credentials or Compose edits. Include it in the same image pre-pull closure.
    const url = declared[name]!.environment?.DATABASE_URL;
    const target = url ? postgresUrl(url) : undefined;
    if (target?.hostname === "postgres" && (!target.port || target.port === "5432")) {
      if (!declared.postgres) throw new Error("Local PostgreSQL service is missing");
      pending.push("postgres");
    }
  }
  return needed;
}
export class ComposeRelease implements ReleaseOperations {
  private active: Release;
  private databaseDrift = false;
  private stopped = false;
  onMutation: () => void = () => {};
  constructor(readonly root: string, readonly envFile: string, readonly project: string, readonly next: Release,
    readonly save: ReleaseOperations["save"], readonly override?: string, readonly healthTimeout = 90000,
    readonly environment: Record<string, string | undefined> = process.env,
    readonly diagnosticsDirectory?: string) { this.active = next; }

  async compose(args: string[], release = this.active) {
    return command(["docker", "compose", "--project-name", this.project, "--env-file", this.envFile,
      "-f", "apps/backend/docker-compose.yml", ...(this.override ? ["-f", this.override] : []), "--profile", "database", ...args], this.root,
      { ...this.environment, RELEASE_SHA: release.sha, RELEASE_IMAGE: release.image }, this.diagnosticsDirectory);
  }
  async config() { return JSON.parse(await this.compose(["config", "--format", "json"])); }
  async stopMigration() {
    const ids = (await command(["docker", "ps", "-aq", "--filter", `label=com.docker.compose.project=${this.project}`,
      "--filter", "label=com.docker.compose.service=migration"], this.root, this.environment)).split(/\s+/).filter(Boolean);
    if (!ids.length) return;
    const records = JSON.parse(await command(["docker", "inspect", ...ids], this.root, this.environment));
    if (!records.every((record: { Config: { Labels: Record<string, string> } }) =>
      record.Config.Labels["com.docker.compose.project"] === this.project && record.Config.Labels["com.docker.compose.service"] === "migration")) {
      throw new Error("Migration container ownership mismatch");
    }
    await command(["docker", "stop", "--timeout", "10", ...ids], this.root, this.environment);
  }
  private dependencyImagesReady = false;
  // Services start with --pull never. A fresh host has no cached third-party images, so fetch only the
  // missing ones the released services depend on before anything stops; an existing host keeps
  // exactly the image it already runs, and unrelated (for example fixture) services are not touched.
  private async ensureDependencyImages() {
    if (this.dependencyImagesReady) return;
    const declared = (await this.config()).services as Record<string, { image?: string; depends_on?: Record<string, unknown>; environment?: Record<string, string> }>;
    for (const name of releaseDependencyClosure(declared, [...services, "migration"])) {
      const image = declared[name]!.image;
      if (!image || image === this.next.image) continue;
      try { await command(["docker", "image", "inspect", image], this.root, this.environment); }
      catch { await this.compose(["pull", "--quiet", name], this.next); }
    }
    this.dependencyImagesReady = true;
  }
  async preflight() {
    await this.ensureDependencyImages();
    const config = await this.config();
    const declared = config.services;
    const migration = declared.migration?.environment;
    if (migration) {
      postgresUrl(migration.DATABASE_URL, true);
      postgresUrl(migration.API_DATABASE_URL);
      postgresUrl(migration.WORKER_DATABASE_URL, true);
    }
    if (releaseDependencyClosure(declared, [...services, "migration"]).has("postgres")) {
      const db = declared.postgres;
      if (!db?.environment?.POSTGRES_PASSWORD) {
        throw new Error("Local PostgreSQL requires POSTGRES_PASSWORD");
      }
      const ids = (await this.compose(["ps", "-aq", "postgres"])).split(/\s+/).filter(Boolean);
      const records = ids.length ? JSON.parse(await command(["docker", "inspect", ...ids], this.root, this.environment)) : [];
      if (records.length > 1 || records.some((record: ContainerState) =>
        record.Config.Labels["com.docker.compose.project"] !== this.project ||
        record.Config.Labels["com.docker.compose.service"] !== "postgres")) throw new Error("PostgreSQL container ownership mismatch");
      if (!records.length || !records[0].State.Running) this.onMutation();
      // Preflight can initialize a fresh host, but must never replace a live DB.
      await this.compose(["up", "-d", "--no-recreate", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "90", "postgres"], this.next);
      const expected = (await this.compose(["config", "--hash", "postgres"])).split(/\s+/);
      if (expected.length !== 2 || expected[0] !== "postgres") throw new Error("PostgreSQL configuration hash unavailable");
      this.databaseDrift = records.length > 0 && records[0].Config.Labels["com.docker.compose.config-hash"] !== expected[1];
    }
    await this.compose(["run", "--rm", "--no-deps", "migration", "bun", "release/cli.ts", "preflight"], this.next);
  }
  async stop() {
    this.stopped = false;
    // Stop new requests first, then recheck runs before stopping their owner.
    await this.compose(["stop", "--timeout", "30", "api", "ws-server"]);
    try { await this.preflight(); }
    catch (error) {
      await this.compose(["start", "api", "ws-server"]);
      throw error;
    }
    await this.compose(["stop", "--timeout", "30", "worker"]);
    // Inspect every application container, including paused/restarting states.
    // Allow a bounded engine-state transition after stop; never migrate on timeout.
    let blockers: string[] = [];
    try {
      await waitFor(async () => {
        const ids = (await this.compose(["ps", "-aq", ...services])).split(/\s+/).filter(Boolean);
        blockers = ids.length ? applicationStopBlockers(JSON.parse(await command(["docker", "inspect", ...ids], this.root, this.environment)), this.project) : [];
        return blockers.length === 0;
      }, 5000);
    } catch (error) { throw new Error(`Application shutdown not verified${blockers.length ? ` (${blockers.join(", ")})` : ""}`, { cause: error }); }
    this.stopped = true;
  }
  async migrate() {
    if (this.databaseDrift && !this.stopped) throw new Error("PostgreSQL configuration drift requires verified application shutdown");
    // The migration CLI also proves no worker owns the database. Do that before
    // replacement, which would otherwise erase evidence of a foreign session lock.
    await this.compose(["run", "--rm", "--no-deps", "migration", "bun", "release/cli.ts", "migrate"], this.next);
    if (this.databaseDrift) {
      this.onMutation();
      await this.compose(["up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "90", "postgres"], this.next);
      await this.preflight();
      if (this.databaseDrift) throw new Error("PostgreSQL configuration drift remains after replacement");
    }
  }
  async postcheck() { await this.compose(["run", "--rm", "--no-deps", "migration", "bun", "release/cli.ts", "postcheck"], this.next); }
  async resume() {
    this.stopped = false;
    await this.compose(["start", ...services]);
  }
  async start(release: Release) {
    this.stopped = false;
    this.active = release;
    await verifyImage(release, this.root, this.environment);
    await this.compose(["up", "-d", "--no-build", "--pull", "never", "--scale", "worker=1", ...services]);
  }
  async ready(release: Release) {
    await waitFor(async () => {
      try {
        const ids = (await this.compose(["ps", "-q", ...services])).split(/\s+/).filter(Boolean);
        if (ids.length !== 3) return false;
        const records = JSON.parse(await command(["docker", "inspect", ...ids], this.root, this.environment));
        if (!records.every((record: { Image: string; State: { Health?: { Status: string } } }) =>
          record.Image === release.imageId && record.State.Health?.Status === "healthy")) return false;
        for (const service of services) {
          const port = service === "api" ? "3000" : service === "worker" ? "3002" : "3001";
          await this.compose(["exec", "-T", service, "bun", "health/probe.ts", port]);
        }
        return true;
      } catch { return false; }
    }, this.healthTimeout);
  }
}

export async function verifyImage(release: Release, root: string, environment: Record<string, string | undefined> = process.env) {
  const [image] = JSON.parse(await command(["docker", "image", "inspect", release.image], root, environment));
  if (image.Id !== release.imageId || image.Config.Labels?.["org.opencontainers.image.revision"] !== release.sha ||
      image.Config.Labels?.["org.opencontainers.image.source"] !== "https://github.com/binaryrishabh/InfraForge") {
    throw new Error("Image ID/source/revision does not match the approved release");
  }
}

export function settingsFingerprint(config: { services: Record<string, { environment: Record<string, string> }> }) {
  return createHash("sha256").update(JSON.stringify(services.map((name) =>
    Object.entries(config.services[name]!.environment).filter(([key]) => key !== "RELEASE_SHA").sort(([a], [b]) => a.localeCompare(b))))).digest("hex");
}
