// Run from a directory with playwright, pngjs and pixelmatch installed:
// node <this-script> <reference-html-directory> <built-url> <evidence-directory> [chromium-executable]
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const require = createRequire(join(process.cwd(), "package.json"));
const { chromium } = require("playwright");
const { PNG } = require("pngjs");
const { default: pixelmatch } = await import(pathToFileURL(require.resolve("pixelmatch")).href);
const [reference, built, evidence, executablePath] = process.argv.slice(2);
if (!evidence) throw new Error("Expected reference directory, built URL, evidence directory, optional Chromium executable");
mkdirSync(evidence, { recursive: true });
const server = createServer((req, res) => {
  const name = new URL(req.url, "http://localhost").pathname.slice(1);
  if (!["index.html", "engineering.html", "learning.html"].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(readFileSync(join(resolve(reference), name)));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const referenceUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const results = [];
try {
  for (const scenario of [
    { page: "index", mode: "intro", scroll: 0 },
    { page: "index", mode: "scroll-0.4", scroll: 0.4 },
    ...["engineering", "learning"].flatMap((page) => ["light", "dark"].map((mode) => ({ page, mode }))),
  ]) {
    const captures = [];
    for (const [label, url] of [["reference", `${referenceUrl}/${scenario.page}.html`], ["built", `${built}/${scenario.page === "index" ? "" : scenario.page}`]]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "light" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      // Step only animation frames at a fixed 20 Hz. Both documents receive the same
      // performance clock and frame sequence, independent of machine load/font fetch.
      // Real page code runs unchanged; queued product frames stay frozen for capture.
      await page.addInitScript(() => {
        let now = 0, id = 0, queue = new Map(), frozen = false;
        const nativeFrame = window.requestAnimationFrame.bind(window);
        Object.defineProperty(performance, "now", { value: () => now });
        window.requestAnimationFrame = (callback) => {
          if (frozen) return nativeFrame(callback);
          queue.set(++id, callback); return id;
        };
        window.cancelAnimationFrame = (key) => queue.delete(key);
        window.__proofAdvance = (duration) => {
          for (let elapsed = 0; elapsed < duration; elapsed += 50) {
            now += 50; const batch = queue; queue = new Map();
            for (const callback of batch.values()) callback(now);
          }
        };
        window.__proofFreeze = () => {
          frozen = true;
          for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = now; }
        };
      });
      await page.goto(`${url}${scenario.page === "index" ? "" : `?mode=${scenario.mode}`}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      if (scenario.page === "index") {
        await page.evaluate(() => window.__proofAdvance(16000));
        if (scenario.scroll) {
          await page.evaluate((fraction) => window.scrollTo(0, fraction * (document.querySelector(".track").offsetHeight - innerHeight)), scenario.scroll);
          await page.evaluate(() => window.__proofAdvance(3000));
        }
      } else {
        await page.evaluate(() => window.__proofAdvance(1000));
      }
      const semantics = await page.evaluate(() => {
        const structured = document.querySelector('script[type="application/ld+json"]');
        return {
          title: document.title, description: document.querySelector('meta[name="description"]')?.content,
          canonical: document.querySelector('link[rel="canonical"]')?.href,
          graph: structured ? JSON.parse(structured.textContent)["@graph"] : null,
          faq: [...document.querySelectorAll(".faq details, .qa > div")].map((el) => ({ question: el.querySelector("summary, h3").textContent, answer: el.querySelector("p").textContent })),
          theme: document.querySelector(".ui")?.dataset.theme || document.documentElement.dataset.mode,
        };
      });
      if (label === "built") {
        const canonical = `https://infraforge.lapwork.in/${scenario.page === "index" ? "" : scenario.page}`;
        assert.equal(semantics.canonical, canonical);
        if (scenario.page !== "index") assert.deepEqual(semantics.graph[0].mainEntity.map((entry) => ({ question: entry.name, answer: entry.acceptedAnswer.text })), semantics.faq);
      }
      assert.deepEqual(errors, [], `${label} browser errors`);
      await page.evaluate(() => window.__proofFreeze());
      const pair = {};
      for (const fullPage of [false, true]) {
        const kind = fullPage ? "full" : "viewport";
        const path = join(evidence, `${scenario.page}-${scenario.mode}-${label}-${kind}.png`);
        pair[kind] = PNG.sync.read(await page.screenshot({ path, fullPage, timeout: 30000 }));
      }
      captures.push({ pair, semantics });
      await context.close();
    }
    for (const kind of ["viewport", "full"]) {
      const a = captures[0].pair[kind], b = captures[1].pair[kind];
      assert.equal(a.width, b.width); assert.equal(a.height, b.height);
      let raw = 0, maxChannelDelta = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        let changed = false;
        for (let c = 0; c < 4; c++) { const delta = Math.abs(a.data[i + c] - b.data[i + c]); if (delta) changed = true; maxChannelDelta = Math.max(maxChannelDelta, delta); }
        if (changed) raw++;
      }
      const diff = new PNG({ width: a.width, height: a.height });
      const nonAA = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1, includeAA: false });
      writeFileSync(join(evidence, `${scenario.page}-${scenario.mode}-${kind}-diff.png`), PNG.sync.write(diff));
      const result = { ...scenario, kind, width: a.width, height: a.height, rawDifferentPixels: raw, nonAADifferentPixels: nonAA, maxChannelDelta, theme: captures[1].semantics.theme };
      results.push(result); console.log(JSON.stringify(result));
    }
  }
  writeFileSync(join(evidence, "results.json"), JSON.stringify(results, null, 2) + "\n");
  assert.ok(results.every((result) => result.nonAADifferentPixels === 0), "Non-antialiasing visual differences detected");
} finally {
  await browser.close(); await new Promise((done) => server.close(done));
}
