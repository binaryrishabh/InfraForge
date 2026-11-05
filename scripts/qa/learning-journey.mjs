// Real-browser walk through the learning pages against a LOCAL dev stack (http://localhost:5173 + api on :3000).
// Creates one disposable account on that local stack (generated password, never printed) and records what it saw.
// Run on the QA box:  cd ~/qa/pw && node ../InfraForge/scripts/qa/learning-journey.mjs   (playwright-core is installed there)
// It only ever talks to localhost and refuses any other origin.
import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

const WEB = process.env.JOURNEY_WEB ?? "http://localhost:5173";
if (!/^http:\/\/localhost:\d+$/.test(WEB)) { console.error("journey only runs against a localhost dev stack"); process.exit(2); }
const { chromium } = createRequire(process.env.PW_DIR ? `${process.env.PW_DIR}/package.json` : `${process.cwd()}/package.json`)("playwright-core");
const SHOTS = process.env.JOURNEY_SHOTS ?? `${process.cwd()}/learn-shots`; mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror ${page.url()} ${e.message.slice(0, 160)}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`console ${page.url()} ${m.text().slice(0, 160)}`); });
page.on("response", (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url().replace(WEB, "")}`); });

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try { const detail = await fn(); results.push({ name, ok: true, ms: Date.now() - t, ...(detail ? { detail } : {}) }); }
  catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t, error: String(e.message ?? e).split("\n")[0].slice(0, 300) });
    await page.screenshot({ path: `${SHOTS}/FAIL-${results.length}-${name.replace(/\W+/g, "-")}.png` }).catch(() => {});
  }
}
const text = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
const id = randomBytes(4).toString("hex"), password = `Aa1!${randomBytes(12).toString("base64url")}x9`;

await step("sign up a disposable account", async () => {
  await page.goto(`${WEB}/signup`, { waitUntil: "load", timeout: 90_000 });
  await page.locator('input[name="username"]').waitFor({ timeout: 90_000 });
  const email = page.locator("#signup-email-direct"); if (await email.count()) await email.fill(`journey-${id}@example.test`);
  await page.locator('input[name="username"]').fill(`journey${id}`);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('form button[type="submit"]').last().click();
  await page.waitForURL(/\/home/, { timeout: 60_000 });
  return page.url().replace(WEB, "");
});
await step("home loads and offers a way into learning", async () => {
  await page.waitForLoadState("networkidle").catch(() => {});
  const body = await text();
  return { continueLearning: /continue learning|start learning|learning/i.test(body), learningLink: await page.locator('a[href="/learn"]').count() };
});
await step("learning page lists tracks and lessons from the server", async () => {
  await page.goto(`${WEB}/learn`, { waitUntil: "load" });
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /\d+ lessons? found/.test(document.body.innerText), null, { timeout: 30_000 });
  const body = await text();
  await page.screenshot({ path: `${SHOTS}/1-learning.png`, fullPage: true });
  return { found: /(\d+) lessons? found/.exec(body)?.[1], mentionsRunnableLab: /runnable lab/i.test(body), tracksSeen: ["Foundations", "Scaling", "Databases", "Asynchronous", "Failures", "Missions"].filter((t) => body.includes(t)) };
});
await step("a reading lesson renders its sections and never claims a simulated result", async () => {
  await page.goto(`${WEB}/learn/lessons/what-is-a-request`, { waitUntil: "load" });
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30_000 });
  const body = await text();
  await page.screenshot({ path: `${SHOTS}/2-reading.png`, fullPage: true });
  if (/requirements? met|recorded run showed/i.test(body)) throw new Error("reading lesson talks about run results");
  return { headings: await page.getByRole("heading").allInnerTexts(), hasLimits: /limit/i.test(body) };
});
await step("a concept check answers immediately and the answer is remembered on this device", async () => {
  await page.goto(`${WEB}/learn/lessons/client-and-server`, { waitUntil: "load" });
  const radios = page.getByRole("radio");
  await radios.first().waitFor({ timeout: 30_000 });
  await radios.first().check();
  await page.getByRole("status").filter({ hasText: /match|explanation|Review/i }).first().waitFor({ timeout: 10_000 });
  await page.reload({ waitUntil: "load" });
  await page.getByRole("radio").first().waitFor({ timeout: 30_000 });
  return { restoredAfterReload: await page.getByRole("radio").first().isChecked() };
});
await step("a runnable lab lesson offers its pinned challenge and says no result is known yet", async () => {
  await page.goto(`${WEB}/learn/lessons/where-does-the-time-go`, { waitUntil: "load" });
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30_000 });
  const body = await text();
  await page.screenshot({ path: `${SHOTS}/3-lab.png`, fullPage: true });
  if (!(await page.getByRole("button", { name: /open challenge lab/i }).count())) throw new Error("no Open challenge lab control");
  return { noClaimBeforeRun: /No recorded attempt is linked here\. No outcome is claimed/.test(body), mentionsPrediction: /predict/i.test(body) };
});
await step("the lesson opens the real challenge workspace with its starter, requirements and a prediction gate", async () => {
  await page.getByRole("button", { name: /open challenge lab/i }).click();
  await page.waitForURL(/\/design\?design=/, { timeout: 60_000 });
  await page.getByRole("button", { name: /predict and run/i }).waitFor({ timeout: 60_000 });
  const body = await text();
  await page.screenshot({ path: `${SHOTS}/4-workspace.png` });
  return { url: page.url().replace(WEB, "").replace(/design=.*/, "design=<id>"), title: /Where does the time go\?/.test(body), brief: /Fixed conditions/.test(body), requirements: /Checked during the run/.test(body), predictionGate: /commit to one prediction first/i.test(body) };
});
await step("Predict and run asks for the prediction before any run starts", async () => {
  await page.getByRole("button", { name: /predict and run/i }).click();
  const dialog = page.getByRole("dialog").first();
  await dialog.waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/5-prediction.png` });
  return { dialogText: (await dialog.innerText()).replace(/\s+/g, " ").slice(0, 700), buttons: await dialog.getByRole("button").allInnerTexts(), radios: await dialog.getByRole("radio").count(), selects: await dialog.locator("select").count() };
});
await step("a prediction is locked and the real browser run starts and stops at its evaluation second", async () => {
  const dialog = page.getByRole("dialog").first();
  await dialog.getByRole("radio").first().check();
  await dialog.getByRole("textbox").first().fill("The app does three times the CPU work per read.").catch(() => {});
  await dialog.getByRole("button", { name: /lock prediction and run/i }).click();
  await page.screenshot({ path: `${SHOTS}/6-running.png` });
  // The run is limited to simulated second 12; wait for the app to show a finished attempt rather than guessing a duration.
  await page.getByRole("link", { name: /see the result/i }).waitFor({ timeout: 240_000 });
  await page.screenshot({ path: `${SHOTS}/7a-finished.png` });
  await page.getByRole("link", { name: /see the result/i }).click();
  await page.waitForURL(/\/runs\//, { timeout: 120_000 });
  await page.waitForFunction(() => /Your prediction/.test(document.body.innerText) && /requirements? met/.test(document.body.innerText), null, { timeout: 120_000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/7-after-run.png` });
  const body = await text();
  return { url: page.url().replace(WEB, "").replace(/(design|run)[=/][^&]*/g, "$1=<id>"), debrief: body.slice(body.indexOf("Challenge result")).slice(0, 1500), buttons: await page.getByRole("button").allInnerTexts(), links: (await page.getByRole("link").allInnerTexts()).slice(0, 14) };
});
await step("the recorded result page shows the challenge verdict, the prediction against the record and a way back to the lesson", async () => {
  await page.waitForURL(/\/runs\//, { timeout: 60_000 }).catch(() => {});
  const body = await text();
  await page.screenshot({ path: `${SHOTS}/8-result.png`, fullPage: true });
  return { url: page.url().replace(WEB, "").replace(/runs\/.*/, "runs/<id>"), verdict: /(\d+ of \d+ requirements? met at \d+s)/.exec(body)?.[1] ?? null, notMetOrMet: /Not met|Met/.exec(body)?.[0] ?? null, predictionComparison: /Your prediction/.test(body) && /recorded/.test(body), partOfLesson: /Part of lesson/.test(body), debrief: body.slice(Math.max(0, body.indexOf("Your design"))).slice(0, 900) };
});
await step("the lesson now shows the learner's own recorded attempt from the server", async () => {
  await page.goto(`${WEB}/learn/lessons/where-does-the-time-go`, { waitUntil: "load" });
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /Server activity:/.test(document.body.innerText) && !/No recorded attempts/.test(document.body.innerText), null, { timeout: 30_000 });
  const body = await text();
  await page.screenshot({ path: `${SHOTS}/9-lesson-after.png`, fullPage: true });
  return { activity: /Server activity: ([^·]*)/.exec(body)?.[1]?.trim(), whatRunShowed: body.slice(Math.max(0, body.search(/latest (recorded )?attempt|What (did )?your run/i))).slice(0, 700) };
});
await step("one change is planned with a written hypothesis and the earlier design reopens", async () => {
  await page.goto(`${WEB}/learn/lessons/where-does-the-time-go`, { waitUntil: "load" });
  await page.getByRole("link", { name: /inspect the latest recorded attempt/i }).first().click();
  await page.waitForURL(/\/runs\//, { timeout: 30_000 });
  // The button stays disabled until the server's guided review of this run has loaded; wait for it, retry if the dialog closes on a re-render.
  const plan = page.getByRole("button", { name: /plan one change/i });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /plan one change/i.test(b.textContent ?? "") && !b.disabled), null, { timeout: 120_000 });
  for (let attempt = 0; attempt < 4 && !(await page.locator("textarea").count()); attempt++) { await plan.click(); await page.waitForTimeout(1500); }
  await page.locator("textarea").first().waitFor({ timeout: 30_000 });
  await page.locator("textarea").first().fill("A larger app instance gives the app more CPU, so its queue should shrink and p95 should fall.");
  await page.screenshot({ path: `${SHOTS}/10-plan-change.png` });
  await page.locator('button[form="learning-plan"]').click();
  await page.waitForURL(/\/design/, { timeout: 60_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: `${SHOTS}/11-improvement-design.png` });
  return { url: page.url().replace(WEB, "").replace(/design=.*/, "design=<id>"), hasHypothesisNotice: /hypothesis|one change|improvement/i.test(await text()) };
});
await step("the app's instance size is changed to c5.large in the designer", async () => {
  await page.locator(".react-flow__node, [data-id]").filter({ hasText: /Virtual Machine/ }).first().click({ timeout: 20_000 }).catch(async () => { await page.getByText("app", { exact: true }).first().click(); });
  const size = page.getByRole("radio", { name: /c5\.large/i }).first();
  await size.waitFor({ timeout: 20_000 });
  await size.check();
  await page.screenshot({ path: `${SHOTS}/12-size-changed.png` });
  return { chosen: await size.isChecked(), resources: /(\d+) resources/.exec(await text())?.[1] };
});
await step("the improved design runs through the same prediction gate and its recorded result is shown", async () => {
  await page.getByRole("button", { name: /predict and run/i }).click();
  const dialog = page.getByRole("dialog").first();
  await dialog.waitFor({ timeout: 30_000 });
  await dialog.getByRole("radio").first().check();
  await dialog.getByRole("button", { name: /lock prediction and run/i }).click();
  await page.getByRole("link", { name: /see the result/i }).waitFor({ timeout: 240_000 });
  await page.getByRole("link", { name: /see the result/i }).click();
  await page.waitForURL(/\/runs\//, { timeout: 120_000 });
  await page.waitForFunction(() => /Your design/.test(document.body.innerText) && /requirements? met/.test(document.body.innerText), null, { timeout: 120_000 });
  const body = await text();
  await page.screenshot({ path: `${SHOTS}/13-improved-result.png`, fullPage: true });
  return { verdict: /(\d+ of \d+ requirements? met at \d+s)/.exec(body)?.[1], whatChanged: body.slice(Math.max(0, body.search(/change|hypothesis|compared|same conditions/i))).slice(0, 700) };
});
await step("the two runs can be compared and the comparison states its conditions", async () => {
  const improved = page.getByRole("link", { name: /compare with the attempt you improved/i });
  if (await improved.count()) await improved.first().click(); else await page.getByRole("link", { name: /compare with/i }).first().click();
  await page.waitForURL(/\/runs\/compare/, { timeout: 60_000 });
  await page.getByRole("heading", { level: 1, name: /compare two runs/i }).waitFor({ timeout: 90_000 });
  await page.waitForFunction(() => /Challenge conditions|One simulation-relevant design change|design change/i.test(document.body.innerText), null, { timeout: 90_000 });
  const body = await text();
  await page.screenshot({ path: `${SHOTS}/14-compare.png`, fullPage: true });
  return { verdictAndConditions: body.slice(body.indexOf("Compare two runs")).slice(0, 1500) };
});
await step("the lesson shows the factual progress after the improvement", async () => {
  await page.goto(`${WEB}/learn/lessons/where-does-the-time-go`, { waitUntil: "load" });
  await page.waitForFunction(() => /Server activity:/.test(document.body.innerText), null, { timeout: 30_000 });
  const body = await text();
  await page.screenshot({ path: `${SHOTS}/15-lesson-final.png`, fullPage: true });
  return { activity: /Server activity: ([^·]*?)(?= Prerequisites| Problem)/.exec(body)?.[1]?.trim(), attempts: /(\d+) (recorded )?attempts?/i.exec(body)?.[0] ?? null };
});
await step("keyboard: lesson page can be operated with Tab only", async () => {
  await page.goto(`${WEB}/learn/lessons/client-and-server`, { waitUntil: "load" });
  await page.getByRole("radio").first().waitFor({ timeout: 30_000 });
  const focusable = [];
  for (let i = 0; i < 25; i++) { await page.keyboard.press("Tab"); focusable.push(await page.evaluate(() => document.activeElement?.tagName + ":" + (document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent || "").trim().slice(0, 30))); }
  return { reached: [...new Set(focusable)].slice(0, 12) };
});

console.log(JSON.stringify({ web: WEB, results, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, problems: [...new Set(problems)].slice(0, 12) }, null, 1));
await browser.close();
