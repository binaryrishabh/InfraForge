import { expect, spyOn, test } from "bun:test";
import { prepareReleaseImage } from "../release/image";
import * as releaseProcess from "../release/process";
import * as build from "../release/build";

const accepted = { sha: "a".repeat(40), image: "infraforge-backend:accepted", imageId: `sha256:${"b".repeat(64)}`,
  migrationFingerprint: "schema", authContract: 1, settingsFingerprint: "old-settings" };

test("configuration reapply verifies accepted content and metadata without building or retagging", async () => {
  const calls: string[][] = [];
  let id = accepted.imageId, metadata = { sha: accepted.sha, migrationFingerprint: "schema", authContract: 1 };
  const labels: Record<string, string> = { "org.opencontainers.image.revision": accepted.sha,
    "org.opencontainers.image.source": "https://github.com/binaryrishabh/InfraForge" };
  const run = spyOn(releaseProcess, "command").mockImplementation(async args => {
    calls.push(args);
    if (args[1] === "image") return JSON.stringify([{ Id: id, Config: { Labels: labels } }]);
    if (args[1] === "run") return JSON.stringify(metadata);
    throw new Error("Unexpected mutation command");
  });
  const buildImage = spyOn(build, "buildReleaseImage").mockRejectedValue(new Error("Must not rebuild accepted image"));
  try {
    const next = await prepareReleaseImage("reconfigure", accepted.sha, { current: accepted }, ".");
    expect(next.image).toBe(accepted.imageId);
    expect(next.imageId).toBe(accepted.imageId);
    expect(calls.find(args => args[1] === "run")?.[5]).toBe(accepted.imageId);
    expect(buildImage).not.toHaveBeenCalled();
    await expect(prepareReleaseImage("reconfigure", accepted.sha, undefined, ".")).rejects.toThrow("currently accepted");
    await expect(prepareReleaseImage("reconfigure", "c".repeat(40), { current: accepted }, ".")).rejects.toThrow("currently accepted");
    await expect(prepareReleaseImage("apply", accepted.sha, { current: accepted }, ".")).rejects.toThrow("retained accepted");
    await expect(prepareReleaseImage("apply", accepted.sha, { current: { ...accepted, sha: "c".repeat(40) }, previous: accepted }, ".")).rejects.toThrow("retained accepted");
    id = `sha256:${"d".repeat(64)}`;
    await expect(prepareReleaseImage("reconfigure", accepted.sha, { current: accepted }, ".")).rejects.toThrow("Image ID/source/revision");
    id = accepted.imageId;
    for (const key of ["org.opencontainers.image.revision", "org.opencontainers.image.source"]) {
      const original = labels[key]!;
      labels[key] = "unapproved";
      await expect(prepareReleaseImage("reconfigure", accepted.sha, { current: accepted }, ".")).rejects.toThrow("Image ID/source/revision");
      labels[key] = original;
    }
    for (const changed of [{ migrationFingerprint: "other" }, { authContract: 2 }, { sha: "e".repeat(40) }]) {
      metadata = { sha: accepted.sha, migrationFingerprint: "schema", authContract: 1, ...changed };
      await expect(prepareReleaseImage("reconfigure", accepted.sha, { current: accepted }, ".")).rejects.toThrow("metadata");
    }
    metadata = { sha: accepted.sha, migrationFingerprint: "schema", authContract: 1 };
    labels["org.infraforge.rehearsal"] = "fixture";
    await expect(prepareReleaseImage("reconfigure", accepted.sha, { current: accepted }, ".")).rejects.toThrow("Test-only");
    expect(buildImage).not.toHaveBeenCalled();
  } finally { run.mockRestore(); buildImage.mockRestore(); }
});
