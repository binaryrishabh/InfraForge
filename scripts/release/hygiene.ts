import { open, readFile, statfs, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { command } from "./process";
import type { AcceptedState } from "./image";

export const minimumReleaseFreeBytes = 8n * 1024n ** 3n;
const repository = "infraforge-backend:";
type Image = { Id: string; RepoTags: string[] | null };

export function assertReleaseSpace(measurements: { path: string; available: bigint }[], stateDirectory: string) {
  const measured = measurements.map(({ path, available }) => `${path}: ${available} bytes available`).join("; ");
  if (measurements.some(({ available }) => available < minimumReleaseFreeBytes)) {
    throw new Error(`Release disk preflight refused: ${measured}; require ${minimumReleaseFreeBytes} bytes (8 GiB) on EACH filesystem. ` +
      `Safe retained-image cleanup: bun --no-env-file scripts/release/hygiene.ts prune ${JSON.stringify(resolve(stateDirectory))}. ` +
      "This preserves accepted/previous/in-use images; if insufficient, expand the disk or review database/backup capacity. Never use docker system prune --volumes.");
  }
  console.log(`Release disk preflight: ${measured}; minimum ${minimumReleaseFreeBytes} bytes each`);
}

// State may not exist on a fresh host. Measure its nearest existing parent before
// creating even the lock/directory. Missing/inaccessible measurements fail closed.
async function existingParent(path: string): Promise<string> {
  try { await stat(path); return path; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(path) === path) throw error;
    return existingParent(dirname(path));
  }
}
export async function preflightReleaseSpace(root: string, stateDirectory: string, run = command,
  measure = async (path: string) => { const fs = await statfs(path, { bigint: true }); return fs.bavail * fs.bsize; }) {
  const dockerRoot = await run(["docker", "info", "--format", "{{.DockerRootDir}}"], root);
  if (!dockerRoot.startsWith("/")) throw new Error("Docker data root unavailable; disk capacity is Unknown, release refused");
  const statePath = await existingParent(resolve(stateDirectory));
  const measurements = [];
  for (const path of [dockerRoot, statePath]) measurements.push({ path, available: await measure(path) });
  assertReleaseSpace(measurements, stateDirectory);
}

export function selectReleaseImages(images: Image[], state: AcceptedState, inUse: string[]) {
  if (!state?.current?.imageId || state.previous && !state.previous.imageId) throw new Error("Accepted image IDs unavailable; cleanup refused");
  const keep = new Set([state.current.imageId, state.previous?.imageId, ...inUse]);
  return images.filter(image => !keep.has(image.Id) && image.RepoTags?.length &&
    image.RepoTags.every(tag => tag.startsWith(repository)));
}

export async function pruneAcceptedImages(root: string, stateDirectory: string, run = command, log = console.log) {
  // Read the durable acceptance, never a proposed release or a guessed latest tag.
  const state = JSON.parse(await readFile(resolve(stateDirectory, "accepted.json"), "utf8")) as AcceptedState;
  const ids = (await run(["docker", "image", "ls", "--quiet", "--no-trunc", "--filter", "reference=infraforge-backend:*"], root)).split(/\s+/).filter(Boolean);
  if (!ids.length) return;
  const images = JSON.parse(await run(["docker", "image", "inspect", ...new Set(ids)], root)) as Image[];
  const containers = (await run(["docker", "ps", "--all", "--quiet", "--no-trunc"], root)).split(/\s+/).filter(Boolean);
  const inUse = containers.length ? (JSON.parse(await run(["docker", "inspect", ...containers], root)) as { Image: string }[]).map(item => item.Image) : [];
  for (const image of selectReleaseImages(images, state, inUse)) {
    for (const tag of image.RepoTags!) {
      const [fresh] = JSON.parse(await run(["docker", "image", "inspect", tag], root)) as Image[];
      if (fresh?.Id !== image.Id) throw new Error("Image tag changed during cleanup; refusing removal");
      // No force, no implicit parent pruning, no unrelated tags or build caches.
      const result = await run(["docker", "image", "rm", "--no-prune", tag], root);
      log(`Release cleanup ${image.Id} ${tag}: ${result}`);
    }
  }
}

if (import.meta.main) {
  const [action, directory] = process.argv.slice(2);
  if (action !== "prune" || !directory) throw new Error("Use: bun --no-env-file scripts/release/hygiene.ts prune <state-directory>");
  const lockPath = resolve(directory, "release.lock");
  const lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("Release lock exists; inspect recovery state before cleanup"); });
  try { await pruneAcceptedImages(process.cwd(), directory); }
  finally { await lock.close(); await unlink(lockPath); }
}
