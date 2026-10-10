import { createHash } from "node:crypto";
import { command, waitFor } from "./process";
import type { Release, ReleaseOperations } from "./sequence";

const services = ["api", "worker", "ws-server"];
export class ComposeRelease implements ReleaseOperations {
  private active: Release;
  constructor(readonly root: string, readonly envFile: string, readonly project: string, readonly next: Release,
    readonly save: ReleaseOperations["save"], readonly override?: string, readonly healthTimeout = 90000,
    readonly environment: Record<string, string | undefined> = process.env) { this.active = next; }

  async compose(args: string[], release = this.active) {
    return command(["docker", "compose", "--project-name", this.project, "--env-file", this.envFile,
      "-f", "apps/backend/docker-compose.yml", ...(this.override ? ["-f", this.override] : []), ...args], this.root,
      { ...this.environment, RELEASE_SHA: release.sha, RELEASE_IMAGE: release.image });
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
  async preflight() { await this.compose(["run", "--rm", "--no-deps", "migration", "bun", "release/cli.ts", "preflight"], this.next); }
  async stop() {
    // Stop new requests first, then recheck runs before stopping their owner.
    await this.compose(["stop", "--timeout", "30", "api", "ws-server"]);
    try { await this.preflight(); }
    catch (error) {
      await this.compose(["start", "api", "ws-server"]);
      throw error;
    }
    await this.compose(["stop", "--timeout", "30", "worker"]);
    if ((await this.compose(["ps", "--status", "running", "-q", ...services])).trim()) throw new Error("Application containers did not stop");
  }
  async migrate() { await this.compose(["run", "--rm", "--no-deps", "migration", "bun", "release/cli.ts", "migrate"], this.next); }
  async postcheck() { await this.compose(["run", "--rm", "--no-deps", "migration", "bun", "release/cli.ts", "postcheck"], this.next); }
  async start(release: Release) {
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
