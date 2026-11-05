import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("recorded Model 2 attempt -> report -> lesson -> learner hypothesis -> improvement -> compare is navigable", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./fixtures/learningLoop.tsx", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(JSON.parse(stdout)).toEqual({ loop: true, hintNeverSubmitted: true, realModel2: true, guards: true, missingEvidence: true });
}, 180000);
