const { chromium, firefox, webkit } = await import(process.argv[2]);
const url = process.argv[3], cases = await (await fetch(new URL("cases", url))).json(), results = [];
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
  : JSON.stringify(value);
for (const [name, launcher] of [["chromium", chromium], ["firefox", firefox], ["webkit", webkit]]) {
  const browser = await launcher.launch({ headless: true, timeout: 30000 });
  try {
    const page = await browser.newPage(); await page.goto(url); await page.addScriptTag({ url: new URL("runner.js", url).href, type: "module" });
    await page.waitForFunction(() => typeof globalThis.runFirstStackInBrowser === "function");
    for (const c of cases) {
      const actual = await page.evaluate(async request => {
        let ticks = 0; const timer = setInterval(() => ticks++, 1);
        try { return { result: await globalThis.runFirstStackInBrowser(request).result, ticks }; }
        finally { clearInterval(timer); }
      }, c.request);
      const evidence = actual.result.evidence;
      if (actual.result.status !== "completed" || !evidence || evidence.fingerprint !== c.expected.fingerprint || evidence.inputHash !== c.inputHash) throw Error(`${name} worker mismatch ${c.name}/${c.seed}: ${JSON.stringify(actual)}`);
      if (canonical({ ...evidence.cut, effectiveLimits: null }) !== c.expected.canonicalCut) throw Error(`${name} canonical worker cut differs from server (including report capture): ${c.name}/${c.seed}`);
      if (!actual.ticks) throw Error(`${name} page heartbeat did not progress`);
      const checked = await fetch(new URL("verify", url), { method: "POST", body: JSON.stringify(evidence) });
      if (!checked.ok) throw Error(`${name} worker cut rejected by server reader`);
    }
    const lifecycle = await page.evaluate(async request => {
      const cancelled = globalThis.runFirstStackInBrowser(request); cancelled.cancel();
      const a = await cancelled.result;
      const b = await globalThis.runFirstStackInBrowser({ ...request, wallMs: 1 }).result;
      const c = await globalThis.runFirstStackInBrowser({ ...request, engine: { ...request.engine, source: "a".repeat(64) } }).result;
      return [a, b, c].map(r => r.status === "interrupted" && r.evidence === null);
    }, cases[0].request);
    if (lifecycle.some(ok => !ok)) throw Error(`${name} worker lifecycle failed`);
    results.push({ engine: name, version: browser.version(), cases: cases.length, lifecycle: 3, heartbeat: "PASS", serverReader: "PASS", result: "PASS" });
    console.error(`${name}: ${cases.length} real-worker cuts, heartbeat and 3 lifecycle checks passed`);
  } finally { await browser.close(); }
}
console.log(JSON.stringify(results));
