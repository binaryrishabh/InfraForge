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

const unknownStorage = "Release disk preflight refused: image/snapshot storage filesystem is Unknown. " +
  "Only classic overlay2 or the default system containerd overlayfs snapshotter is verified. " +
  "Do not assume /var/lib/containerd or switch storage drivers as cleanup.";
const absolute = (value: unknown): value is string => typeof value === "string" && value.startsWith("/") &&
  !value.split("/").includes("..") && !/[\0\n\r]/.test(value);

// Values of one TOML table from `containerd config dump` (top level is ""). Only
// plain single-line string assignments are read; anything else stays Unknown.
export function containerdTable(dump: string, table: string) {
  const values = new Map<string, string>();
  let current = "";
  for (const line of dump.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\][]+)\]\s*$/);
    if (header) { current = header[1]!.trim().replace(/^'(.*)'$|^"(.*)"$/, "$1$2"); continue; }
    const pair = line.match(/^\s*([A-Za-z_]+)\s*=\s*(?:'([^']*)'|"([^"\\]*)")\s*$/);
    if (current === table && pair) values.set(pair[1]!, pair[2] ?? pair[3]!);
  }
  return values;
}

// The containerd image store keeps content and snapshots under containerd's own
// root, not DockerRootDir. Accept it only when Docker uses the default system
// containerd and that exact daemon's effective config names Docker's socket.
async function containerdStorage(info: { Driver?: unknown; Containerd?: unknown }, root: string, run: typeof command,
  read: (path: string) => Promise<string>) {
  const address = (info.Containerd as { Address?: unknown } | null | undefined)?.Address;
  if (info.Driver !== "overlayfs" || !absolute(address)) throw new Error(unknownStorage);
  const pid = (await run(["systemctl", "show", "containerd.service", "--property=MainPID", "--value"], root)).trim();
  if (!/^[1-9][0-9]*$/.test(pid)) throw new Error(unknownStorage);
  // Flags such as --config, --root or --address would make the default dump differ from the running daemon.
  const argv = (await read(`/proc/${pid}/cmdline`)).split("\0").filter(Boolean);
  if (argv.length !== 1 || !/(^|\/)containerd$/.test(argv[0]!)) throw new Error(unknownStorage);
  const dump = await run(["sudo", "-n", "containerd", "config", "dump"], root);
  const containerdRoot = containerdTable(dump, "").get("root"), grpc = containerdTable(dump, "grpc").get("address");
  if (!absolute(containerdRoot) || grpc !== address) throw new Error(unknownStorage);
  const base = containerdRoot.replace(/\/+$/, "");
  return [base, `${base}/io.containerd.content.v1.content`, `${base}/io.containerd.snapshotter.v1.overlayfs`];
}

export async function preflightReleaseSpace(root: string, stateDirectory: string, run = command, measure = availableReleaseBytes,
  read = (path: string) => readFile(path, "utf8")) {
  let info: { DockerRootDir?: unknown; Driver?: unknown; DriverStatus?: unknown; Containerd?: unknown };
  try { info = JSON.parse(await run(["docker", "info", "--format", "{{json .}}"], root)); }
  catch (error) { throw new Error("Docker storage layout unavailable; disk capacity is Unknown, release refused", { cause: error }); }
  const dockerRoot = info?.DockerRootDir;
  if (typeof dockerRoot !== "string" || !dockerRoot.startsWith("/")) throw new Error("Docker data root unavailable; disk capacity is Unknown, release refused");
  if (!Array.isArray(info.DriverStatus)) throw new Error(unknownStorage);
  const driverTypes = info.DriverStatus.filter(row => Array.isArray(row) && row[0] === "driver-type");
  let imagePaths: string[];
  if (info.Driver === "overlay2" && driverTypes.length === 0) imagePaths = [`${dockerRoot.replace(/\/+$/, "")}/overlay2`];
  else if (driverTypes.length === 1 && driverTypes[0]![1] === "io.containerd.snapshotter.v1") {
    try { imagePaths = await containerdStorage(info, root, run, read); }
    catch (error) { throw new Error(unknownStorage, { cause: error }); }
  } else throw new Error(unknownStorage);
  const statePath = await existingParent(resolve(stateDirectory));
  const measurements = [];
  for (const path of [dockerRoot, ...imagePaths, statePath]) {
    try { measurements.push({ path, available: await measure(path) }); }
    catch (error) { throw new Error(`Disk capacity for ${path} is Unknown; release refused`, { cause: error }); }
  }
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
