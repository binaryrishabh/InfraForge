import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReleaseImage } from "../release/build";
import { command } from "../release/process";
import { APPROVED_IMAGE_REPOSITORY, APPROVED_IMAGE_SOURCE } from "../release/registry";
import { fullSha } from "../release/public-check";

// Runs on the GitHub runner, never on the production host. Builds the exact approved commit with the
// existing Dockerfile, proves its identity, publishes it, and outputs the immutable digest reference.
export async function publishReleaseImage(sha: string, run = command, root = process.cwd(), env: Record<string, string | undefined> = process.env) {
  fullSha(sha);
  const user = env.REGISTRY_USER, token = env.REGISTRY_TOKEN;
  if (!user || !token) throw new Error("Registry credentials are required to publish the release image");
  // The tag only names this run's upload; the digest, not the tag, is the authority carried into the release.
  const tag = `${APPROVED_IMAGE_REPOSITORY}:sha-${sha}-${env.GITHUB_RUN_ID ?? "local"}-${env.GITHUB_RUN_ATTEMPT ?? "1"}`;
  const config = await mkdtemp(join(tmpdir(), "infraforge-publish-"));
  const docker = (...args: string[]) => ["docker", "--config", config, ...args];
  try {
    await buildReleaseImage(sha, tag, root, (args, cwd) => run(args[0] === "docker" ? docker(...args.slice(1)) : args, cwd));
    const [built] = JSON.parse(await run(docker("image", "inspect", tag), root)) as { Id: string; Architecture?: string; Config: { Labels?: Record<string, string> } }[];
    const labels = built?.Config?.Labels ?? {};
    if (labels["org.opencontainers.image.revision"] !== sha || labels["org.opencontainers.image.source"] !== APPROVED_IMAGE_SOURCE) {
      throw new Error("Built image labels do not match the approved release");
    }
    const metadata = JSON.parse(await run(docker("run", "--rm", "--network", "none", built!.Id, "cat", "/app/apps/backend/release.json"), root));
    if (metadata.sha !== sha || typeof metadata.migrationFingerprint !== "string" || !metadata.migrationFingerprint || metadata.authContract !== 1) {
      throw new Error("Embedded release metadata does not match the approved release");
    }
    await run(docker("login", APPROVED_IMAGE_REPOSITORY.split("/")[0]!, "--username", user, "--password-stdin"), root, process.env, undefined, token);
    await run(docker("push", "--quiet", tag), root);
    const [pushed] = JSON.parse(await run(docker("image", "inspect", tag), root)) as { RepoDigests?: string[] }[];
    const reference = pushed?.RepoDigests?.find(value => value.startsWith(`${APPROVED_IMAGE_REPOSITORY}@sha256:`));
    if (!reference) throw new Error("The registry did not return an immutable digest for the published image");
    return { reference, architecture: built!.Architecture ?? "Unknown" };
  } finally {
    await run(docker("logout", APPROVED_IMAGE_REPOSITORY.split("/")[0]!), root).catch(() => {});
    await rm(config, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [action, sha = ""] = process.argv.slice(2);
  if (action !== "publish") throw new Error("Use: bun --no-env-file scripts/deploy/image.ts publish <full-sha>");
  const result = await publishReleaseImage(sha);
  console.log(`Published ${result.reference} (${result.architecture})`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `reference=${result.reference}\n`);
}
