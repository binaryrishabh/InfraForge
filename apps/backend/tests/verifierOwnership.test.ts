import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("verifier poll, job and health checks never queue concurrent pg queries", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install",
    fileURLToPath(new URL("./verifierOwnershipHarness.ts", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  expect({ code, error }).toEqual({ code: 0, error: "" });
  expect(output).toContain("Verifier checks serialize on the real pg query queue");
});
