import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("the actual prediction dialog retains answers, prevents duplicate submits and explains uncertain starts beside real reports", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./fixtures/attemptStartFailures.tsx", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(JSON.parse(stdout)).toEqual({ realDialog: true, retained: true, duplicateBlocked: true, preflightRefused: true, uncertainStart: true, realModel2Report: true });
}, 180000);
