import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { verifyModuleLoading, withFullLoadingAnalysis } from "../executionIdentity/loading";

test("systemd observation is fixed, bounded, non-root and fails closed", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install",
    fileURLToPath(new URL("./verifierUnitHarness.ts", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({ code, error }).toEqual({ code: 0, error: "" });
  expect(output).toContain("Fixed bounded systemd observation passed");
});

test("host observations retain exact-source loader permissions without general process access", () => {
  for (const file of ["firstStack/isolationConnection.ts", "firstStack/qualificationFingerprint.ts", "executionIdentity/loading.ts"]) {
    const path = `apps/backend/${file}`, source = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
    expect(() => withFullLoadingAnalysis(() => verifyModuleLoading(source, path))).not.toThrow();
    expect(() => withFullLoadingAnalysis(() => verifyModuleLoading(source + '\nimport {execSync} from "node:child_process"; execSync("unexpected");\n', path))).toThrow("Unreviewed");
  }
});
