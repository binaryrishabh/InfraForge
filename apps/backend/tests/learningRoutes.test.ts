import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

test("learning routes exercise real engine history with session auth, 404s, current content and owner isolation", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./fixtures/learningRoutes.ts", import.meta.url))],
    { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(JSON.parse(stdout)).toMatchObject({ realEngineSequence: ["not-started", "attempted", "requirements-met"],
    authAnd404: true, earlierVersions: true, ownerIsolation: true });
}, 180000);

test("production mounts learning with the same session guard as challenges, before domain routers", () => {
  const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  expect(source).toContain('app.use("/api/challenges", requireSession);');
  expect(source).toContain('app.use("/api/learning", requireSession);');
  expect(source).toContain('app.use("/api/learning", learningRouter);');
  expect(source.indexOf('app.use("/api/learning", requireSession);')).toBeLessThan(source.indexOf('app.use("/api/learning", learningRouter);'));
});
