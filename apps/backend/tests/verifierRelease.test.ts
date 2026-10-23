import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

for (const scenario of ["release-first", "verifier-first", "postcheck", "failure"]) {
  test(`release and verifier exclude each other: ${scenario}`, async () => {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install",
      fileURLToPath(new URL("./verifierReleaseHarness.ts", import.meta.url)), scenario],
    { stdout: "pipe", stderr: "pipe" });
    const [code, output, error] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    expect({ code, error: code === 0 ? "" : error }).toEqual({ code: 0, error: "" });
    expect(output).toContain(`Release exclusion ${scenario} passed`);
  });
}
