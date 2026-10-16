import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { expect } from "bun:test";
import { runSandbox } from "../../apps/backend/internalModel2/sandboxRunner";
import type { SandboxReceipt } from "../../apps/backend/internalModel2/sandboxRunner";
import { docker } from "../../apps/backend/internalModel2/sandboxDocker";
import { checkOrphanDeadline } from "../../apps/backend/tests/integration/lessonOrphanChecks";
import { command } from "./command";
import { fixture } from "./fixture";
export async function probeSandbox(baseImage: string, output: string) {
  const context = join(output, "bounded-fixture"), tag = `infraforge-host-${randomUUID()}`, base = `${tag}-base`;
  await mkdir(context); await Bun.write(join(context, "sandboxChild.ts"), fixture);
  await docker(["tag", baseImage, base]);
  const results: Record<string, unknown> = {};
  try {
    await Bun.write(join(context, "Dockerfile"), `FROM ${base}\nCOPY --chown=1000:1000 sandboxChild.ts /app/apps/backend/internalModel2/sandboxChild.ts\n`);
    await command("docker", ["build", "--pull=false", "--network=none", "-t", tag, context]);
    const image = (JSON.parse(await docker(["image", "inspect", tag]))[0]).Id;
    for (const kind of ["controls", "quota", "pids", "cpu", "memory", "wall"]) {
      let receipt: SandboxReceipt | undefined, value: any, failure = "";
      try { await runSandbox(randomUUID(), image, { fixture: kind }, async (frame) => {
        if (frame.kind === "probe-ready") return { continue: true };
        if (frame.kind !== "controls") throw Error("Unexpected probe frame"); value = frame.value;
      }, async (r) => { receipt = structuredClone(r); }); }
      catch (error) { failure = error instanceof Error ? error.message : "Probe failed"; }
      results[kind] = { receipt, value, failure };
      await Bun.write(join(output, "partial-enforcement.json"), JSON.stringify({ baseImage, image, results }));
      if (["controls", "quota", "pids"].includes(kind)) expect(failure).toBe(""); else expect(failure.length).toBeGreaterThan(0);
      if (kind === "controls") {
        expect(value).toMatchObject({ readonly: true, noexec: true, uid: 1000, gid: 1000, capabilities: true, noNewPrivileges: true, fdDenied: true });
        expect(value.interfaces).toEqual(["lo"]); expect(value.tmpType).toBe(0x01021994); expect(value.tmpBytes).toBeLessThanOrEqual(16777216);
        expect(value.files).toBeGreaterThan(0); expect(value.files).toBeLessThan(128);
      }
      if (kind === "quota") {
        expect(value.after.nr_throttled).toBeGreaterThan(value.before.nr_throttled);
        expect(value.after.throttled_usec).toBeGreaterThan(value.before.throttled_usec);
        expect(value.after.usage_usec - value.before.usage_usec).toBeGreaterThan(1000000);
      }
      if (kind === "pids") { expect(value.denied).toBe(true); expect(value.count).toBeGreaterThan(0); expect(value.count).toBeLessThan(64); }
      if (kind === "memory") expect(receipt?.exit?.oom).toBe(true);
      if (kind === "cpu") { expect(receipt?.exit?.oom).toBe(false); expect(receipt?.exit?.code).not.toBe(0); expect(receipt?.elapsedMs).toBeLessThan(15000); }
      if (kind === "wall") { expect(receipt?.elapsedMs).toBeGreaterThanOrEqual(14000); expect(receipt?.elapsedMs).toBeLessThan(25000); }
    }
    const orphan = await checkOrphanDeadline(image, output);
    return { baseImage, image, fixture, results, orphan };
  } finally {
    // Only this invocation's unique tags. Never prune a daemon or remove volumes.
    await docker(["image", "rm", tag, base]);
  }
}
