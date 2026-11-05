import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("learning hooks preserve request, retry, identity, device and focus lifecycles", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./fixtures/learningHooks.ts", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(JSON.parse(stdout)).toEqual({ requests: true, retry: true, staleResponse: true, storage: true, focus: true, loaders: true });
});
