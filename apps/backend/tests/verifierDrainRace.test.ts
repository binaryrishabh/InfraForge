import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

for (const stage of ["ownership", "outbox"]) {
  test(`shutdown preserves active authority across the pending ${stage} readiness query`, async () => {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install",
      fileURLToPath(new URL("./verifierDrainRaceHarness.ts", import.meta.url)), stage],
    { stdout: "pipe", stderr: "pipe" });
    const [code, output, error] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    expect({ code, error }).toEqual({ code: 0, error: "" });
    expect(output).toContain(`Drain race ${stage} passed`);
  });
}
