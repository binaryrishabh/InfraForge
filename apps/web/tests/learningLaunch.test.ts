import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("the lesson launch button uses the existing workspace client and designer navigation, preserving run guards and failures", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./fixtures/learningLaunch.tsx", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(JSON.parse(stdout)).toEqual({ openedChallenge: "first-production-api", designer: "/design?design=lesson%20workspace%2F1",
    liveGuard: true, startingGuard: true, finishedViewLeft: true, failedOpenStayedOnLesson: true });
}, 180000);
