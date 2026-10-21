// Test-only Playwright is installed outside the application dependency graph:
// npm install --prefix .cache/browser-tooling --no-save --package-lock=false playwright@1.64.1
// node .cache/browser-tooling/node_modules/playwright/cli.js install chromium firefox webkit
// bun --no-env-file scripts/browser-first-stack/determinism.ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical } from "../../apps/backend/firstStack/canonical";
import { readIsolatedCut } from "../../apps/backend/firstStack/isolationProtocol";
import { probe } from "./probe";
import { serverCases, fixtureRows } from "./oracle";
import pin from "../../apps/web/src/firstStack/enginePin.json";

const modulePath = process.env.MODEL2_BROWSER_MODULE ?? resolve(".cache/browser-tooling/node_modules/playwright/index.mjs");
const build = await Bun.build({ entrypoints: [resolve("scripts/browser-first-stack/probe.ts")], target: "browser", format: "iife" });
if (!build.success) throw new AggregateError(build.logs, "Browser bundle failed");
const js = await build.outputs[0]!.text();
const workerMode = process.argv.includes("--worker"), modules = new Map<string, string>();
if (workerMode) for (const [url, entrypoint] of [["/runner.js", "scripts/browser-first-stack/runner-probe.ts"], ["/worker/entry.ts", "apps/web/src/firstStack/worker/entry.ts"]]) {
  const built = await Bun.build({ entrypoints: [resolve(entrypoint!)], target: "browser", format: "esm" });
  if (!built.success) throw new AggregateError(built.logs, "Worker browser bundle failed");
  modules.set(url!, await built.outputs[0]!.text());
}
if (workerMode && process.argv.includes("--vite")) {
  modules.set("/runner.js", await Bun.file(".cache/browser-build/runner.js").text());
  for await (const file of new Bun.Glob("*.js").scan(".cache/browser-build/assets")) modules.set(`/assets/${file}`, await Bun.file(`.cache/browser-build/assets/${file}`).text());
}
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
  const path = new URL(req.url).pathname;
  if (modules.has(path)) return new Response(modules.get(path), { headers: { "content-type": "application/javascript" } });
  if (path === "/verify") {
    const value = await req.json(); readIsolatedCut(value, pin.source, value.inputHash); return Response.json({ valid: true });
  }
  return path === "/cases"
  ? Response.json(cases) : new URL(req.url).pathname === "/probe.js" ? new Response(js)
  : new Response("<!doctype html><title>First stack determinism</title>", { headers: { "content-type": "text/html" } });
} });
const cases = (await serverCases()).map(c => ({ ...c, request: { input: c.workerInput,
  engine: { source: pin.source, image: `sha256:${"b".repeat(64)}` } } }));
try {
  const retained = await Bun.file("scripts/fixtures/browser-server-results.json").json();
  if (canonical(retained.cases) !== canonical(fixtureRows(cases))) throw Error("Current server cuts differ from retained server fixtures; review and regenerate oracle.ts --write");
  for (const c of cases) if (canonical(await probe(c.input)) !== canonical(c.expected)) throw Error(`Bun browser probe disagrees with current server cut: ${c.name}/${c.seed}`);
  // Node hosts browser automation: Bun still executes the server oracle and builds
  // the browser bytes. Avoid Bun/Windows Playwright child-pipe incompatibilities.
  const child = Bun.spawn(["node", workerMode ? "scripts/browser-first-stack/worker-compare.mjs" : "scripts/browser-first-stack/compare.mjs", pathToFileURL(modulePath).href, server.url.href], { stdout: "pipe", stderr: "inherit" });
  const output = await new Response(child.stdout).text();
  if (await child.exited !== 0) throw Error("Browser determinism gate failed; stop before runner implementation");
  const results = JSON.parse(output);
  const report = { schema: "first-stack-browser-determinism/1", bun: Bun.version,
    tool: "playwright@1.64.1", results, cases: fixtureRows(cases) };
  await Bun.write(workerMode ? ".cache/browser-worker.json" : ".cache/browser-determinism.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally { server.stop(true); }
