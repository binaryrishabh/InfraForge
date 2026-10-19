import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("denying policy protects actual admission/writer/action paths without database writes", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "fixtures/capability-paths.ts")], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
  expect(JSON.parse(stdout)).toEqual({ cases: 22, protectedSideEffects: 0 });
}, 30000);
