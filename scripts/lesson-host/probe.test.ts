import { expect, test } from "bun:test";
import { mkdir, rmdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { collect } from "./collect";
import { evaluate } from "./policy";
import { command } from "./command";
import { probeSandbox } from "./probeSandbox";
import { lessonSource } from "../../apps/backend/tests/integration/lessonSource";
import { provenance } from "./identity";
// Explicit opt-in on an idle dedicated host. No preflight bypass for CI or root.
test.skipIf(process.env.LESSON_HOST_PROBE !== "1")("rootless host enforcement with the approved installed image", async () => {
  const image = process.env.MODEL2_LESSON_IMAGE ?? "", revision = process.env.LESSON_HOST_REVISION ?? "", output = process.env.LESSON_HOST_OUTPUT;
  if (!/^sha256:[a-f0-9]{64}$/.test(image) || !/^[a-f0-9]{40}$/.test(revision) || !output) throw Error("Supply approved immutable image, revision and a new absolute output directory");
  if (resolve(output) !== output || !output.startsWith("/")) throw Error("Absolute Linux output directory required");
  const proof: Record<string, unknown> = { schema: "infraforge-lesson-host-enforcement/1", kind: "operator-host-probe", revision,
    image, lessonSource: lessonSource(), provenance: provenance(), checkedAt: new Date().toISOString(), rootlessReady: false, success: false };
  await mkdir(output, { mode: 0o700 }); // Fails rather than overwrite another proof.
  const lock = `/run/user/${process.getuid?.()}/infraforge-lesson-host-probe.lock`; let held = false;
  try {
    const before = evaluate(await collect(image), image, revision); proof.preflight = before;
    expect(before.eligibleForProbes).toBe(true);
    await mkdir(lock, { mode: 0o700 }); held = true;
    expect(evaluate(await collect(image), image, revision).eligibleForProbes).toBe(true);
    proof.enforcement = await probeSandbox(image, output);
    expect(await command("docker", ["ps", "--all", "--quiet"])).toBe("");
    const after = evaluate(await collect(image), image, revision); proof.after = after; expect(after.eligibleForProbes).toBe(true);
    proof.success = true;
  } finally {
    if (held) await rmdir(lock);
    // Even a successful mechanism probe leaves operational gates Unknown.
    await writeFile(`${output}/host-proof.json`, JSON.stringify(proof, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  }
}, 240000);
