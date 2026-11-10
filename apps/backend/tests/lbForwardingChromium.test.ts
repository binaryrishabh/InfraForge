import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { captureRunInputs } from "../deployments/runInputs";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { lbForwardingLabFixture } from "./lbForwardingLab.fixture";

const chromium = [process.env.LB_TEST_CHROMIUM,
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1248/chrome-win64/chrome.exe"),
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find((p): p is string => !!p && existsSync(p));

// Runs actual Chromium/V8. Set LB_TEST_CHROMIUM when its binary is elsewhere.
test.skipIf(!chromium)("native Chromium matches server contracts and full evidence/views at all 21 LB forwarding boundaries", async () => {
  const cache = resolve(import.meta.dir, "../../../.cache"); await mkdir(cache, {recursive: true});
  const directory = await mkdtemp(join(cache, "lb-forwarding-chromium-"));
  try {
    const {d, designs} = lbForwardingLabFixture();
    const vectors = designs.map(design => {
      const input = captureRunInputs(design, d.workload, challengeSeed(d)), run = createModel2Engine(input, 6);
      const ticks = [{view: run.view(), evidence: run.evidence()}];
      for (let second = 1; second <= 6; second++) {run.advance(); ticks.push({view: run.view(), evidence: run.evidence()});}
      return {input, contract: buildContractFromRunInputs(input, 6), ticks};
    });
    const entry = join(directory, "entry.ts"), bundle = join(directory, "browser.js"), html = join(directory, "index.html");
    await writeFile(entry, `import {createModel2Run} from "../../packages/simulation/src/model2Run";
import {buildContractFromRunInputs} from "../../packages/simulation/src/model2/product/runContract";
const vectors = ${JSON.stringify(vectors)};
let boundaries = 0;
try {
  const same = (a, b, where) => {if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(where);};
  for (const [variant, vector] of vectors.entries()) {
    same(buildContractFromRunInputs(vector.input, 6), vector.contract, "contract " + variant);
    const run = createModel2Run(vector.input, 6);
    for (let second = 0; second <= 6; second++) {
      if (second) run.advance();
      same(run.view(), vector.ticks[second].view, "view " + variant + ":" + second);
      same(run.evidence(), vector.ticks[second].evidence, "evidence " + variant + ":" + second);
      boundaries++;
    }
  }
  document.body.textContent = "LB_FORWARDING_PARITY_RESULT " + JSON.stringify({ok: true, variants: vectors.length, boundaries});
} catch (error) {document.body.textContent = "LB_FORWARDING_PARITY_RESULT " + JSON.stringify({ok: false, boundaries, error: String(error)});}
`, "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entry, "--target=browser", "--format=iife", "--outfile", bundle], {stdout: "ignore", stderr: "pipe"});
    const diagnostic = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostic);
    await writeFile(html, '<!doctype html><html><body><script src="browser.js"></script></body></html>', "utf8");
    const browser = Bun.spawn([chromium!, "--headless", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
      `--user-data-dir=${join(directory, "profile")}`, "--dump-dom", pathToFileURL(html).href], {stdout: "pipe", stderr: "pipe"});
    const [stdout, stderr] = await Promise.all([new Response(browser.stdout).text(), new Response(browser.stderr).text()]);
    expect(await browser.exited, stderr.slice(-2000)).toBe(0);
    const match = /LB_FORWARDING_PARITY_RESULT (\{[^<]+\})/.exec(stdout);
    expect(match, stdout.slice(-2000)).not.toBeNull();
    const result = JSON.parse(match![1]!);
    expect(result).toEqual({ok: true, variants: 3, boundaries: 21});
    console.info("lb-forwarding-native-chromium", JSON.stringify(result));
  } finally {
    if (dirname(directory) !== cache || !basename(directory).startsWith("lb-forwarding-chromium-")) throw Error("Unexpected Chromium workspace cleanup target");
    await rm(directory, {recursive: true, force: true});
  }
}, 120000);
