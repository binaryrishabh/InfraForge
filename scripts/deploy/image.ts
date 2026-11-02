import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReleaseImage } from "../release/build";
import { command } from "../release/process";
import { APPROVED_IMAGE_REPOSITORY, APPROVED_IMAGE_SOURCE, approvedImageReference, pullApprovedImage } from "../release/registry";
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

/**
 * Runs in the RELEASE job, with that job's own fresh workflow token, before anything touches production:
 * proves the exact published digest is readable with the same token class the host will later receive,
 * and that its repository, source, revision and embedded release metadata are the approved release.
 */
export async function verifyPublishedImage(sha: string, reference: string, run = command, root = process.cwd(), env: Record<string, string | undefined> = process.env) {
  fullSha(sha);
  approvedImageReference(reference);
  const user = env.REGISTRY_USER, token = env.REGISTRY_TOKEN;
  if (!user || !token) throw new Error("Registry credentials are required to prove access to the release image");
  const local = await pullApprovedImage(reference, sha, root, { user, token }, run);
  try {
    const metadata = JSON.parse(await run(["docker", "run", "--rm", "--network", "none", local, "cat", "/app/apps/backend/release.json"], root));
    if (metadata.sha !== sha || typeof metadata.migrationFingerprint !== "string" || !metadata.migrationFingerprint || metadata.authContract !== 1) {
      throw new Error("Embedded release metadata does not match the approved release");
    }
    return { reference, migrationFingerprint: metadata.migrationFingerprint as string };
  } finally {
    // The runner keeps nothing from this proof; the host pulls the digest itself.
    await run(["docker", "image", "rm", "--no-prune", local], root).catch(() => {});
    await run(["docker", "image", "rm", "--no-prune", reference], root).catch(() => {});
  }
}

if (import.meta.main) {
  const [action, sha = "", reference = ""] = process.argv.slice(2);
  if (action === "publish") {
    const result = await publishReleaseImage(sha);
    console.log(`Published ${result.reference} (${result.architecture})`);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `reference=${result.reference}\n`);
    // Recorded so a same-SHA retry can later be compared: image reproducibility is not assumed.
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Published release image for ${sha}: \`${result.reference}\`\n`);
  } else if (action === "verify") {
    const result = await verifyPublishedImage(sha, reference);
    console.log(`Verified release-job access to ${result.reference}`);
  } else throw new Error("Use: bun --no-env-file scripts/deploy/image.ts publish <full-sha> | verify <full-sha> <digest-reference>");
}
