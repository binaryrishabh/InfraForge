import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertReleaseSpace, availableReleaseBytes, minimumReleaseFreeBytes, preflightReleaseSpace, pruneAcceptedImages, selectReleaseImages } from "../release/hygiene";

const release = (imageId: string) => ({ sha: imageId, image: `infraforge-backend:${imageId}`, imageId,
  authContract: 1, migrationFingerprint: "schema", settingsFingerprint: "settings" });
const state = { current: release("accepted"), previous: release("previous") };
const image = (Id: string, ...RepoTags: string[]) => ({ Id, RepoTags });
const dockerInfo = { DockerRootDir: "/docker-root", Driver: "overlay2", DriverStatus: [["Backing Filesystem", "extfs"]] };

test("disk floor checks each filesystem, includes exact numbers and safe recovery, accepts equality", () => {
  for (const low of [0, 1]) {
    const measurements = ["/docker", "/state"].map((path, index) => ({ path, available: minimumReleaseFreeBytes - (index === low ? 1n : 0n) }));
    expect(() => assertReleaseSpace(measurements, "/state")).toThrow("8589934591 bytes available");
    expect(() => assertReleaseSpace(measurements, "/state")).toThrow("require 8589934592 bytes");
    expect(() => assertReleaseSpace(measurements, "/state")).toThrow("scripts/release/hygiene.ts prune");
  }
  expect(() => assertReleaseSpace([{ path: "/same", available: minimumReleaseFreeBytes }], "/state")).not.toThrow();
});

test("preflight measures DockerRootDir, image directory and nearest existing state parent without creating state; unknown refuses", async () => {
  const directory = await mkdtemp(join(tmpdir(), "infraforge-space-"));
  try {
    const paths: string[] = [], commands: string[][] = [];
    await preflightReleaseSpace(".", join(directory, "new", "state"), async args => { commands.push(args); return JSON.stringify(dockerInfo); },
      async path => { paths.push(path); return minimumReleaseFreeBytes; });
    expect(paths).toEqual(["/docker-root", "/docker-root/overlay2", directory]);
    expect(commands).toEqual([["docker", "info", "--format", "{{json .}}"]]);
    expect(await Bun.file(join(directory, "new", "state", "release.lock")).exists()).toBe(false);
    expect(await readdir(directory)).toEqual([]);
    await expect(preflightReleaseSpace(".", directory, async () => "")).rejects.toThrow("Unknown");
    await expect(preflightReleaseSpace(".", directory, async () => JSON.stringify(dockerInfo), async () => { throw new Error("statfs unavailable"); })).rejects.toThrow("Unknown");
  } finally { await rm(directory, { recursive: true }); }
});

test("available release bytes exclude reserved free blocks", async () => {
  expect(await availableReleaseBytes("/storage", async () => ({ bavail: 2n, bfree: 9n, bsize: 4096n }))).toBe(8192n);
});

test("protected Docker directories use only available-block counters through noninteractive read-only stat", async () => {
  const denied = async () => { throw Object.assign(new Error("private Docker directory"), { code: "EACCES" }); };
  const calls: string[][] = [];
  expect(await availableReleaseBytes("/docker/overlay2", denied, async args => { calls.push(args); return "2 4096"; })).toBe(8192n);
  expect(calls).toEqual([["sudo", "-n", "stat", "--file-system", "--format=%a %S", "--", "/docker/overlay2"]]);
  for (const counters of ["", "unknown", "-1 4096", "2 0"]) {
    await expect(availableReleaseBytes("/docker/overlay2", denied, async () => counters)).rejects.toThrow("unavailable");
  }
  await expect(availableReleaseBytes("/docker/overlay2", denied, async () => { throw new Error("sudo unavailable"); })).rejects.toThrow("sudo unavailable");
  calls.length = 0;
  await expect(availableReleaseBytes("/docker/overlay2", async () => { throw Object.assign(new Error("missing path"), { code: "ENOENT" }); },
    async args => { calls.push(args); return "2 4096"; })).rejects.toThrow("missing path");
  expect(calls).toEqual([]);
});

test("preflight refuses a low image filesystem even when Docker metadata and state have enough room", async () => {
  const directory = await mkdtemp(join(tmpdir(), "infraforge-split-store-"));
  try {
    const capacities = new Map([[dockerInfo.DockerRootDir, minimumReleaseFreeBytes], [directory, minimumReleaseFreeBytes],
      ["/docker-root/overlay2", 7n], ["/separate/containerd", 3n]]);
    const measure = async (path: string) => capacities.get(path)!;
    await expect(preflightReleaseSpace(".", directory, async () => JSON.stringify(dockerInfo), measure)).rejects.toThrow("/docker-root/overlay2: 7 bytes available");
    capacities.set("/docker-root/overlay2", minimumReleaseFreeBytes);
    // The old DockerRootDir-only query would pass this fixture. The active
    // containerd root cannot be verified from info, so this layout must refuse.
    const containerd = { ...dockerInfo, Driver: "overlayfs", DriverStatus: [["driver-type", "io.containerd.snapshotter.v1"]] };
    const run = async (args: string[]) => args.at(-1) === "{{.DockerRootDir}}" ? dockerInfo.DockerRootDir : JSON.stringify(containerd);
    await expect(preflightReleaseSpace(".", directory, run, measure)).rejects.toThrow("image/snapshot storage filesystem is Unknown");
    for (const change of [{ Driver: "unknown" }, { DriverStatus: null }, { DriverStatus: containerd.DriverStatus }]) {
      await expect(preflightReleaseSpace(".", directory, async () => JSON.stringify({ ...dockerInfo, ...change }), measure)).rejects.toThrow("Unknown");
    }
  } finally { await rm(directory, { recursive: true }); }
});

test("operator cleanup refuses an existing release lock without changing its contents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "infraforge-cleanup-lock-"));
  try {
    const path = join(directory, "release.lock");
    await writeFile(path, "owned by release");
    const child = Bun.spawnSync([process.execPath, "--no-env-file", "scripts/release/hygiene.ts", "prune", directory]);
    expect(child.exitCode).not.toBe(0);
    expect(child.stderr.toString()).toContain("Release lock exists");
    expect(await readFile(path, "utf8")).toBe("owned by release");
    expect(await readdir(directory)).toEqual(["release.lock"]);
  } finally { await rm(directory, { recursive: true }); }
});

test("selection keeps accepted, previous and every container image, and never selects a foreign or unowned image", () => {
  const stale = image("stale", "infraforge-backend:old", "infraforge-backend:alias");
  expect(selectReleaseImages([
    image("accepted", "infraforge-backend:new"), image("previous", "infraforge-backend:old"),
    image("running", "infraforge-backend:running"), image("stopped", "infraforge-backend:stopped"), stale,
    image("db", "postgres:18"), image("cache", "redis:7"), image("other", "other/infraforge-backend:old"),
    image("shared", "infraforge-backend:shared", "foreign:shared"), image("dangling"),
  ], state, ["running", "stopped"])).toEqual([stale]);
  expect(() => selectReleaseImages([], {} as typeof state, [])).toThrow("cleanup refused");
  expect(() => selectReleaseImages([stale], { current: state.current, previous: { ...state.previous, imageId: "" } }, [])).toThrow("cleanup refused");
});

test("cleanup reads durable accepted IDs, inspects all containers and only removes exact owned tags without force or parent pruning", async () => {
  const directory = await mkdtemp(join(tmpdir(), "infraforge-prune-"));
  const calls: string[][] = [], logs: string[] = [];
  let changed = false;
  try {
    await writeFile(join(directory, "accepted.json"), JSON.stringify(state));
    const run = async (args: string[]) => {
      calls.push(args);
      if (args[2] === "ls") return "accepted previous stale running";
      if (args[1] === "ps") return "running-container stopped-container";
      if (args[1] === "inspect") return JSON.stringify([{ Image: "running" }, { Image: "previous" }]);
      if (args[2] === "inspect") return JSON.stringify(args.length === 4
        ? [image(changed ? "retagged" : "stale", "infraforge-backend:stale")]
        : [image("accepted", "infraforge-backend:a"), image("previous", "infraforge-backend:b"),
          image("stale", "infraforge-backend:stale"), image("running", "infraforge-backend:c")]);
      if (args[2] === "rm") return "Untagged: infraforge-backend:stale\nDeleted: stale";
      throw new Error("Unexpected command");
    };
    await pruneAcceptedImages(".", directory, run, line => logs.push(line));
    expect(calls.filter(args => args[2] === "rm")).toEqual([["docker", "image", "rm", "--no-prune", "infraforge-backend:stale"]]);
    expect(calls).toContainEqual(["docker", "ps", "--all", "--quiet", "--no-trunc"]);
    expect(logs).toEqual(["Release cleanup stale infraforge-backend:stale: Untagged: infraforge-backend:stale\nDeleted: stale"]);
    calls.length = 0; changed = true;
    await expect(pruneAcceptedImages(".", directory, run)).rejects.toThrow("tag changed");
    expect(calls.some(args => args[2] === "rm")).toBe(false);
    await rm(join(directory, "accepted.json")); calls.length = 0;
    await expect(pruneAcceptedImages(".", directory, run)).rejects.toThrow();
    expect(calls).toEqual([]);
  } finally { await rm(directory, { recursive: true }); }
});
