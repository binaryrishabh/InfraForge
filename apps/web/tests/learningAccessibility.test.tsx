import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("learning accessibility/state audit renders every real lesson and router-derived refusal/version state", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./fixtures/learningAudit.tsx", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  const audit = JSON.parse(stdout);
  expect(audit).toMatchObject({ kinds: ["conceptual-exercise", "executable-lab", "reading"],
    attemptStates: ["unattempted", "failed", "blocked", "stale"], continueStates: ["no-attempts", "one-attempt", "stale-attempt"],
    requestStates: ["loading", "missing-id", "unknown-id", "old-id", "server-error"], filters: true, supersededCurrentVersion: 4 });
  expect(audit.lessons).toBeGreaterThanOrEqual(83);
  expect(audit.checkedReadings).toBeGreaterThan(0);
  expect(audit.uncheckedReadings).toBeGreaterThan(0);
  expect(audit.controls).toBeGreaterThan(100);
  console.log("Learning audit:", JSON.stringify(audit));
}, 180000);
