import { expect, test } from "bun:test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createSystemsModel2 } from "../src/model2/systems/run";
import { coalescingBurst } from "./cdnCoalescing.fixture";
import { quantities } from "./workloadFixture";

test("proof 20: browser-target overlapping bursts, waiter refusals and stale fills equal server execution", async () => {
  const entryPath = resolve(import.meta.dir, `../../../.cache/cdn-coalescing-systems-${process.pid}.ts`), browserPath = entryPath.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entryPath), { recursive: true });
  try {
    await writeFile(entryPath, 'export { createSystemsModel2 } from "../packages/simulation/src/model2/systems/run";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entryPath, "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    const module = await import(pathToFileURL(browserPath).href), browserSystems: typeof createSystemsModel2 = module.createSystemsModel2;
    let cases = 0;
    for (const [coalesce, limit] of [[true, 3], [true, 10], [false, undefined]] as const) for (const purge of [false, true]) {
      const input = coalescingBurst(coalesce, limit);
      if (purge) {
        const q = quantities(); input.systems.interventions.push({ id: "parity-purge", kind: "cdn-purge", target: "cdn", at: q.q("parity-purge.at", 500, "us"), key: "asset" }); input.ledger.push(...q.ledger);
      }
      const b = browserSystems(input), s = createSystemsModel2(input);
      for (const at of [100, 1000, 5000, 40000]) { b.advanceTo(at); s.advanceTo(at); expect(b.evidence()).toEqual(s.evidence()); }
      const c = b.evidence().systems.cdns[0]!;
      expect(c.originRequests).toBe(coalesce ? 1 : 10); expect(c.coalesced).toBe(coalesce ? (limit ?? 10) - 1 : 0);
      expect(b.evidence().systems.commands.results.filter(r => (r.reply as { reason?: string }).reason === "cdn-waiter-capacity")).toHaveLength(limit === 3 ? 7 : 0);
      if (purge) expect(c.staleFills).toBe(coalesce ? 1 : 10);
      cases++;
    }
    console.info("cdn-coalescing-burst-browser-server-parity", JSON.stringify({ cases }));
  } finally { for (const path of [entryPath, browserPath]) if (await Bun.file(path).exists()) await unlink(path); }
});
