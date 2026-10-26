import { open, readFile, statfs, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { command } from "./process";
import { absoluteStoragePath, coded, containerdStorage, dockerdEvidence, storageHost, unknownStorage, verifyLocalDocker, type StorageHost } from "./storage";
import type { AcceptedState } from "./image";

export const minimumReleaseFreeBytes = 8n * 1024n ** 3n;
const repository = "infraforge-backend:";
type Image = { Id: string; RepoTags: string[] | null };

export function assertReleaseSpace(measurements: { path: string; available: bigint }[], stateDirectory: string) {
  const measured = measurements.map(({ path, available }) => `${path}: ${available} bytes available`).join("; ");
  if (measurements.some(({ available }) => available < minimumReleaseFreeBytes)) {
    throw new Error(`Release disk preflight refused: ${measured}; require ${minimumReleaseFreeBytes} bytes (8 GiB) on EACH filesystem. ` +
      `Safe retained-image cleanup: bun --no-env-file scripts/release/hygiene.ts prune ${JSON.stringify(resolve(stateDirectory))}. ` +
      "This preserves accepted/previous/in-use images; if insufficient, expand the disk or review database/backup capacity. Never use docker system prune --volumes. [hygiene check capacity]");
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
export async function availableReleaseBytes(path: string,
  readStats: (path: string) => Promise<{ bavail: bigint; bfree: bigint; bsize: bigint }> = path => statfs(path, { bigint: true }), run = command) {
  try {
    const fs = await readStats(path);
    return fs.bavail * fs.bsize;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EACCES") throw error;
    // The operator cannot traverse Docker's private data directory. Read only
    // filesystem counters through sudo; %a excludes reserved blocks, unlike %f.
    const counters = await run(["sudo", "-n", "stat", "--file-system", "--format=%a %S", "--", path], process.cwd());
    if (!/^\d+ \d+$/.test(counters)) throw new Error("Filesystem counters unavailable");
    const [available, blockSize] = counters.split(" ").map(BigInt);
    if (blockSize === 0n) throw new Error("Filesystem block size unavailable");
    return available! * blockSize!;
  }
}

export async function preflightReleaseSpace(root: string, stateDirectory: string, run = command, measure = availableReleaseBytes,
  host: StorageHost = storageHost(run, root), env = process.env) {
  let info: { DockerRootDir?: unknown; Driver?: unknown; DriverStatus?: unknown; Containerd?: unknown; SecurityOptions?: unknown };
  try { await verifyLocalDocker(root, run, env); info = JSON.parse(await run(["docker", "info", "--format", "{{json .}}"], root)); }
  catch (error) { if (coded(error)) throw error; throw new Error("Docker storage layout unavailable; disk capacity is Unknown, release refused [hygiene check docker-info]", { cause: error }); }
  const dockerRoot = info?.DockerRootDir;
  if (!absoluteStoragePath(dockerRoot)) throw new Error("Docker data root unavailable; disk capacity is Unknown, release refused [hygiene check docker-root]");
  if (!Array.isArray(info.SecurityOptions) || info.SecurityOptions.some(value => typeof value !== "string" || /rootless/i.test(value))) throw new Error(`${unknownStorage} [hygiene check rootless]`);
  if (!Array.isArray(info.DriverStatus)) throw new Error(`${unknownStorage} [hygiene check driver-status]`);
  const docker = await dockerdEvidence(root, run, host);
  const driverTypes = info.DriverStatus.filter(row => Array.isArray(row) && row[0] === "driver-type");
  let imagePaths: string[];
  if (info.Driver === "overlay2" && driverTypes.length === 0) imagePaths = [`${dockerRoot.replace(/\/+$/, "")}/overlay2`];
  else if (driverTypes.length === 1 && driverTypes[0]![1] === "io.containerd.snapshotter.v1") {
    try { imagePaths = await containerdStorage(info, root, run, host); }
    catch (error) { if (coded(error)) throw error; throw new Error(`${unknownStorage} [hygiene check containerd]`); }
  } else throw new Error(`${unknownStorage} [hygiene check layout]`);
  if (await dockerdEvidence(root, run, host) !== docker) throw new Error(`${unknownStorage} [hygiene check instance-changed]`);
  let statePath: string;
  try { statePath = await existingParent(resolve(stateDirectory)); }
  catch { throw new Error("Release state directory is Unknown; release refused [hygiene check state-dir]"); }
  const measurements = [];
  for (const path of [dockerRoot, ...imagePaths, statePath]) {
    try { measurements.push({ path, available: await measure(path) }); }
    catch (error) { throw new Error(`Disk capacity for ${path} is Unknown; release refused [hygiene check measure]`, { cause: error }); }
  }
  assertReleaseSpace(measurements, stateDirectory);
  console.log(`Release Docker instance: ${docker}`);
}

export function selectReleaseImages(images: Image[], state: AcceptedState, inUse: string[]) {
  if (!state?.current?.imageId || state.previous && !state.previous.imageId) throw new Error("Accepted image IDs unavailable; cleanup refused");
  const keep = new Set([state.current.imageId, state.previous?.imageId, ...inUse]);
  return images.filter(image => !keep.has(image.Id) && image.RepoTags?.length &&
    image.RepoTags.every(tag => tag.startsWith(repository)));
}

export async function pruneAcceptedImages(root: string, stateDirectory: string, run = command, log = console.log) {
  await verifyLocalDocker(root, run);
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
  if (!directory || !["prune", "qualify"].includes(action ?? "")) throw new Error("Use: bun --no-env-file scripts/release/hygiene.ts <prune|qualify> <state-directory>");
  if (action === "qualify") {
    await preflightReleaseSpace(process.cwd(), directory);
    process.exit(0);
  }
  const lockPath = resolve(directory, "release.lock");
  const lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("Release lock exists; inspect recovery state before cleanup"); });
  try { await pruneAcceptedImages(process.cwd(), directory); }
  finally { await lock.close(); await unlink(lockPath); }
}
