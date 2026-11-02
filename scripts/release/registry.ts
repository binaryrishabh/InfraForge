import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { command } from "./process";

// The production host never builds the backend image. It pulls one exact digest that a
// GitHub runner published, then proves the content is the approved release before use.
export const APPROVED_IMAGE_REPOSITORY = "ghcr.io/binaryrishabh/infraforge-backend";
export const APPROVED_IMAGE_SOURCE = "https://github.com/binaryrishabh/InfraForge";
const registryHost = APPROVED_IMAGE_REPOSITORY.split("/")[0]!;

export function approvedImageReference(value: string | undefined, repository = APPROVED_IMAGE_REPOSITORY) {
  const escaped = repository.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  if (!value || !new RegExp(`^${escaped}@sha256:[a-f0-9]{64}$`).test(value)) {
    throw new Error("Production release requires an approved exact image digest; this host never builds the backend image and never trusts a mutable tag");
  }
  return value;
}

type Run = typeof command;
// Temporary Docker configs that hold a registry login, so an interrupted release can still remove them.
const configs = new Set<string>();
export async function removeRegistryConfigs() {
  for (const directory of [...configs]) { await rm(directory, { recursive: true, force: true }).catch(() => {}); configs.delete(directory); }
}
export type RegistryAuth = { user: string; token: string };

/**
 * Pull the exact digest, then refuse unless the pulled content carries the approved digest, source,
 * revision and platform. The verified content is tagged with the existing local release name so the
 * retained-image, rollback and Compose machinery stay local and unchanged.
 * Credentials live only in a private temporary Docker config for this pull and are removed afterwards.
 */
export async function pullApprovedImage(reference: string, sha: string, root: string, auth?: RegistryAuth, run: Run = command,
  repository = APPROVED_IMAGE_REPOSITORY) {
  approvedImageReference(reference, repository);
  const config = await mkdtemp(join(tmpdir(), "infraforge-registry-"));
  configs.add(config);
  const docker = (...args: string[]) => ["docker", "--config", config, ...args];
  try {
    if (auth) await run(docker("login", repository.split("/")[0]!, "--username", auth.user, "--password-stdin"), root, process.env, undefined, auth.token);
    await run(docker("pull", "--quiet", reference), root);
    const [image] = JSON.parse(await run(docker("image", "inspect", reference), root)) as { Id: string; Architecture?: string; RepoDigests?: string[];
      Config: { Labels?: Record<string, string> } }[];
    const labels = image?.Config?.Labels ?? {};
    if (!image || typeof image.Id !== "string" || !image.Id.startsWith("sha256:") || !image.RepoDigests?.includes(reference)) {
      throw new Error("Pulled image does not match the approved digest");
    }
    if (labels["org.opencontainers.image.source"] !== APPROVED_IMAGE_SOURCE) throw new Error("Pulled image source does not match the approved repository");
    if (labels["org.opencontainers.image.revision"] !== sha) throw new Error("Pulled image revision does not match the approved release");
    if (labels["org.infraforge.rehearsal"]) throw new Error("Test-only images cannot be accepted for production release");
    const hostArchitecture = (await run(docker("version", "--format", "{{.Server.Arch}}"), root)).trim();
    if (!hostArchitecture || image.Architecture !== hostArchitecture) {
      throw new Error(`Pulled image architecture ${image.Architecture ?? "Unknown"} does not match this host (${hostArchitecture || "Unknown"}); publish a matching platform before releasing here`);
    }
    // Tag by content ID, never by name, so a registry change cannot swap what the release uses.
    await run(["docker", "tag", image.Id, `infraforge-backend:${sha}`], root);
    // Keep exactly one local name. A leftover registry digest reference would keep the image on disk after the
    // release tag is cleaned up (classic overlay2 only untags), so remove it now while the release tag still holds the image.
    await run(["docker", "image", "rm", "--no-prune", reference], root);
    return `infraforge-backend:${sha}`;
  } finally {
    if (auth) await run(docker("logout", registryHost), root).catch(() => {});
    await rm(config, { recursive: true, force: true });
    configs.delete(config);
  }
}
