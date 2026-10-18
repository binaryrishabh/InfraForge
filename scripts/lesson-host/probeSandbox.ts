import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect } from "bun:test";
import { runSandbox } from "../../apps/backend/internalModel2/sandboxRunner";
import type { SandboxReceipt } from "../../apps/backend/internalModel2/sandboxRunner";
import { DockerConnection } from "../../apps/backend/internalModel2/dockerConnection";
import { checkOrphanDeadline } from "../../apps/backend/tests/integration/lessonOrphanChecks";
import { withFixtureImage } from "../../apps/backend/tests/integration/lessonFixtureImage";
import { fixture } from "./fixture";
export async function probeSandbox(baseImage: string, output: string) {
  return DockerConnection.use(async (control) => {
  return withFixtureImage(control, baseImage, join(output, "bounded-fixture"), fixture, async (image, fixtureSource) => {
  const results: Record<string, unknown> = {};
    for (const kind of ["controls", "quota", "pids", "cpu", "memory", "wall"]) {
      let receipt: SandboxReceipt | undefined, value: any, failure = "";
      const id = randomUUID();
      try { await runSandbox(control, id, image, { fixture: kind }, async (frame) => {
        if (frame.kind === "probe-ready") return { continue: true };
        if (frame.kind !== "controls") throw Error("Unexpected probe frame"); value = frame.value;
      }, async (r) => { receipt = structuredClone(r); }, undefined, id, fixtureSource); }
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
    const orphan = await checkOrphanDeadline(control, image, output, fixtureSource);
    return { baseImage, image, connection: control.receipt, fixture, results, orphan };
  });
  });
}
