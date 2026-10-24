import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertReleaseSpace, minimumReleaseFreeBytes, preflightReleaseSpace, pruneAcceptedImages, selectReleaseImages } from "../release/hygiene";

const release = (imageId: string) => ({ sha: imageId, image: `infraforge-backend:${imageId}`, imageId,
  authContract: 1, migrationFingerprint: "schema", settingsFingerprint: "settings" });
const state = { current: release("accepted"), previous: release("previous") };
const image = (Id: string, ...RepoTags: string[]) => ({ Id, RepoTags });

test("disk floor checks each filesystem, includes exact numbers and safe recovery, accepts equality", () => {
  for (const low of [0, 1]) {
    const measurements = ["/docker", "/state"].map((path, index) => ({ path, available: minimumReleaseFreeBytes - (index === low ? 1n : 0n) }));
    expect(() => assertReleaseSpace(measurements, "/state")).toThrow("8589934591 bytes available");
    expect(() => assertReleaseSpace(measurements, "/state")).toThrow("require 8589934592 bytes");
    expect(() => assertReleaseSpace(measurements, "/state")).toThrow("scripts/release/hygiene.ts prune");
  }
  expect(() => assertReleaseSpace([{ path: "/same", available: minimumReleaseFreeBytes }], "/state")).not.toThrow();
});

test("preflight measures DockerRootDir and nearest existing state parent without creating state; unknown refuses", async () => {
  const directory = await mkdtemp(join(tmpdir(), "infraforge-space-"));
  try {
    const paths: string[] = [], commands: string[][] = [];
    await preflightReleaseSpace(".", join(directory, "new", "state"), async args => { commands.push(args); return "/docker-root"; },
      async path => { paths.push(path); return minimumReleaseFreeBytes; });
    expect(paths).toEqual(["/docker-root", directory]);
    expect(commands).toEqual([["docker", "info", "--format", "{{.DockerRootDir}}"]]);
    expect(await Bun.file(join(directory, "new", "state", "release.lock")).exists()).toBe(false);
    await expect(preflightReleaseSpace(".", directory, async () => "")).rejects.toThrow("Unknown");
    await expect(preflightReleaseSpace(".", directory, async () => "/docker", async () => { throw new Error("statfs unavailable"); })).rejects.toThrow("statfs unavailable");
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
