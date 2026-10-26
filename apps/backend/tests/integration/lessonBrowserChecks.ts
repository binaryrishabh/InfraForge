import { expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { LocalHarness, until } from "./localHarness";
import { launchBrowser } from "./browserLaunch";
export async function checkLessonBrowser(h: LocalHarness, cookie: string, output: string) {
  if (!process.env.MODEL2_BROWSER_MODULE) return { executed: false, reason: "Pinned browser runtime unavailable locally" };
  const browser = await launchBrowser(process.env.MODEL2_BROWSER_MODULE);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), at = cookie.indexOf("=");
  await context.addCookies([{ name: cookie.slice(0, at), value: cookie.slice(at + 1), url: h.api, sameSite: "Lax" }]);
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  const node = Bun.which("node"); if (!node) throw Error("Node required for browser proof");
  const server = Bun.spawn([node, "../../node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], { cwd: fileURLToPath(new URL("../../../web/", import.meta.url)), env: { PATH: process.env.PATH, VITE_BACKEND_API_URL: h.api, VITE_INTERNAL_MODEL2_ENABLED: "true", DO_NOT_TRACK: "1" }, stdout: "pipe", stderr: "pipe" });
  let log = ""; for (const stream of [server.stdout, server.stderr]) void (async () => { for await (const chunk of stream) log = (log + new TextDecoder().decode(chunk)).slice(-4000); })();
  try {
    await until(async () => { if (server.exitCode !== null) throw Error(log); try { return (await fetch("http://127.0.0.1:5173", { signal: AbortSignal.timeout(1500) })).ok || undefined; } catch { return undefined; } }, "lesson Vite");
    await h.stop("worker"); await page.goto(h.origin + "/internal/model2/learn");
    await page.getByRole("button", { name: "Create lesson design", exact: true }).click();
    const refreshed = page.waitForResponse((r: any) => r.url().endsWith("/internal/model2/runs") && r.request().method() === "GET");
    await page.getByRole("button", { name: "Refresh designs and history" }).click(); await refreshed;
    await page.getByLabel("When should the read happen?").selectOption("after");
    await page.getByRole("button", { name: "Review lesson", exact: true }).click();
    await page.getByRole("heading", { name: "Review your restart experiment" }).waitFor();
    expect(await page.getByRole("button", { name: "Run reviewed lesson", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Change read phase", exact: true }).click();
    await page.getByLabel("When should the read happen?").selectOption("during");
    await page.getByRole("button", { name: "Review lesson", exact: true }).click();
    await page.getByText("While the process is unavailable at 12000 modeled us.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Change read phase", exact: true }).click();
    await page.getByLabel("When should the read happen?").selectOption("after");
    await page.getByRole("button", { name: "Review lesson", exact: true }).click();
    await page.getByRole("heading", { name: "Review your restart experiment" }).waitFor();
    await page.screenshot({ path: join(output, "lesson-review-desktop.png"), fullPage: true });
    let lost = false, lostId = "", retryKey = "";
    await page.route("**/api/internal/model2/lesson/runs", async (route: any) => {
      if (!lost) { lost = true; retryKey = route.request().postDataJSON().idempotencyKey; const response = await route.fetch(); lostId = (await response.json()).id; await route.abort("failed"); }
      else await route.continue();
    });
    await page.getByLabel("I accept the teaching assumptions", { exact: false }).focus(); await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Run reviewed lesson", exact: true }).press("Enter");
    await page.getByRole("button", { name: "Retry exact lesson submission" }).waitFor(); await page.reload();
    expect(await page.getByRole("button", { name: "Change read phase", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Retry exact lesson submission" }).click({ clickCount: 2 }); await page.waitForURL(/\?run=/);
    const id = new URL(page.url()).searchParams.get("run")!;
    expect(id).toBe(lostId); expect((await h.sql.query('SELECT 1 FROM "InternalModel2Run" WHERE "idempotencyKey"=$1', [retryKey])).rowCount).toBe(1);
    await h.startWorker(); await until(async () => (await h.sql.query('SELECT status FROM "InternalModel2Run" WHERE id=$1', [id])).rows[0]?.status === "completed" || undefined, "guided browser worker completion", 40000);
    await page.getByRole("button", { name: "Refresh durable report" }).click();
    await page.getByRole("heading", { name: "Your recorded read" }).waitFor(); await page.getByText("24 returned object bytes", { exact: false }).waitFor();
    expect(await page.getByRole("region", { name: "Lesson history" }).getByRole("link", { name: "After restart readiness returns · completed", exact: true }).count()).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Verify deterministic replay" }).click(); await page.getByText("Replay: MatchesRecordedPrefix", { exact: false }).waitFor();
    await page.getByRole("region", { name: "Lesson result" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, "lesson-result-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate("document.documentElement.scrollWidth<=window.innerWidth")).toBe(true);
    await page.getByRole("region", { name: "Lesson result" }).scrollIntoViewIfNeeded(); await page.screenshot({ path: join(output, "lesson-result-mobile.png") });
    await page.goto(h.origin + "/internal/model2"); await page.getByText("Internal workspace unavailable for this session", { exact: false }).waitFor();
    return { executed: true, browser: browser.version(), id, cases: ["guided create choose review consent execute result", "phase editing and explicit saved/history refresh", "keyboard consent", "lost response refresh exact retry duplicate click", "actual isolated worker and replay", "mobile no overflow", "advanced authoring refused"] };
  } catch (error) { await page.screenshot({ path: join(output, "lesson-browser-failure.png"), fullPage: true }).catch(() => {}); throw error; }
  finally { await browser.close(); server.kill("SIGKILL"); await server.exited; }
}
