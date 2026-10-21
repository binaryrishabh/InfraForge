const { chromium, firefox, webkit } = await import(process.argv[2]);
const url = process.argv[3], cases = await (await fetch(new URL("cases", url))).json(), results = [];
for (const [name, launcher] of [["chromium", chromium], ["firefox", firefox], ["webkit", webkit]]) {
  const browser = await launcher.launch({ headless: true, timeout: 30000 });
  try {
    const page = await browser.newPage(); await page.goto(url); await page.addScriptTag({ url: new URL("probe.js", url).href });
    for (const c of cases) {
      const actual = await page.evaluate(input => globalThis.firstStackProbe(input), c.input);
      if (actual.canonical !== c.expected.canonical || actual.canonicalCut !== c.expected.canonicalCut || actual.fingerprint !== c.expected.fingerprint) {
        const field = ["canonical", "canonicalCut", "fingerprint"].find(key => actual[key] !== c.expected[key]);
        const expected = c.expected[field], received = actual[field];
        let at = 0; while (received[at] === expected[at] && at < expected.length) at++;
        throw Error(`STOP: ${name} ${c.name}/${c.seed} ${field} differs at UTF-16 offset ${at}; Bun=${expected.slice(Math.max(0, at - 100), at + 150)}; browser=${received.slice(Math.max(0, at - 100), at + 150)}`);
      }
    }
    results.push({ engine: name, version: browser.version(), cases: cases.length, result: "PASS" });
    console.error(`${name}: ${cases.length} byte-identical results and fingerprints`);
  } finally { await browser.close(); }
}
console.log(JSON.stringify(results));
