const { chromium, firefox, webkit } = await import(process.argv[2]);
const url = process.argv[3], cases = await (await fetch(new URL("cases", url))).json(), results = [];
for (const [name, launcher] of [["chromium", chromium], ["firefox", firefox], ["webkit", webkit]]) {
  const browser = await launcher.launch({ headless: true, timeout: 30000 });
  try {
    const page = await browser.newPage(); await page.goto(url); await page.addScriptTag({ url: new URL("probe.js", url).href });
    for (const c of cases) {
      const actual = await page.evaluate(input => globalThis.firstStackProbe(input), c.input);
      if (actual.canonical !== c.expected.canonical || actual.fingerprint !== c.expected.fingerprint) {
        let at = 0; while (actual.canonical[at] === c.expected.canonical[at] && at < c.expected.canonical.length) at++;
        throw Error(`STOP: ${name} ${c.name}/${c.seed} differs at canonical UTF-16 offset ${at}; Bun=${c.expected.canonical.slice(Math.max(0, at - 100), at + 150)}; browser=${actual.canonical.slice(Math.max(0, at - 100), at + 150)}; fingerprints ${c.expected.fingerprint}/${actual.fingerprint}`);
      }
    }
    results.push({ engine: name, version: browser.version(), cases: cases.length, result: "PASS" });
    console.error(`${name}: ${cases.length} byte-identical results and fingerprints`);
  } finally { await browser.close(); }
}
console.log(JSON.stringify(results));
