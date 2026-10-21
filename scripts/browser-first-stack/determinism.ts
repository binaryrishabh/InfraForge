// Test-only Playwright is installed outside the application dependency graph:
// npm install --prefix .cache/browser-tooling --no-save --package-lock=false playwright@1.64.1
// node .cache/browser-tooling/node_modules/playwright/cli.js install chromium firefox webkit
// bun --no-env-file scripts/browser-first-stack/determinism.ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { firstStackCompileFixture } from "../fixtures/first-stack-compile";
import { firstStackCacheFixture } from "../fixtures/first-stack-cache";
import { firstStackFaultFixture } from "../fixtures/first-stack-faults";
import { canonical, hash } from "../../apps/backend/firstStack/canonical";
import { instantiatePreparedFirstStack } from "../../apps/backend/firstStack/execution";
import { captureExecutionCut } from "../../apps/backend/firstStack/executionCut";
import { cutFingerprint, inputDigest, readIsolatedCut } from "../../apps/backend/firstStack/isolationProtocol";
import { probe } from "./probe";
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
const fixtures = [
  ["shared-contention", () => firstStackCompileFixture(2, { shared: true })],
  ["hot-writes", () => firstStackCompileFixture(2, { write: true })],
  ["range-read", () => firstStackCompileFixture(1, { range: true })],
  ["fault-retry", () => firstStackFaultFixture()],
  ["cache-miss-coalescing", () => firstStackCacheFixture()],
  ["cache-ttl-eviction", () => firstStackCacheFixture({ warm: true, capacityBytes: 3, ttlUs: 100,
    rows: [{ id: "z", atUs: 5000, key: "hot" }, { id: "a", atUs: 5000, key: "cold" }, { id: "é", atUs: 9000, key: "hot" }] })],
] as const;
const cases = [];
try {
  for (const [name, make] of fixtures) for (const seed of ["browser-0", "browser-1", "种子-🧪"]) {
    const f = await make(); f.policy.seed = seed;
    const prepared = f.prepare(), runtime = instantiatePreparedFirstStack(prepared);
    runtime.advanceTo(runtime.horizon);
    const cut = captureExecutionCut(prepared, runtime, 1, { wallMs: 60000, cpuUs: 30000000, rssBytes: 536870912,
      frameBytes: 1048576, summaryBytes: 10485760, captureBytes: 33554432 }, null).value;
    const expected = { canonical: canonical({ lock: prepared.lock, evidence: runtime.evidence(), journal: runtime.journal.content() }), fingerprint: cutFingerprint(cut) };
    const input = { sidecar: f.sidecar, schedule: f.schedule, policy: f.policy };
    if (canonical(await probe(input)) !== canonical(expected)) throw Error(`Bun probe disagrees with slice 11: ${name}/${seed}`);
    const workerInput = { owner: "qualification", layout: { ...f.layout, firstStack: f.sidecar }, candidate: f.sidecar, recording: f.schedule, policy: f.policy };
    cases.push({ name, seed, input, expected, request: { input: workerInput, engine: { source: pin.source, image: `sha256:${"b".repeat(64)}` } }, inputHash: inputDigest(canonical(workerInput)) });
  }
  // Node hosts browser automation: Bun still executes the server oracle and builds
  // the browser bytes. Avoid Bun/Windows Playwright child-pipe incompatibilities.
  const child = Bun.spawn(["node", workerMode ? "scripts/browser-first-stack/worker-compare.mjs" : "scripts/browser-first-stack/compare.mjs", pathToFileURL(modulePath).href, server.url.href], { stdout: "pipe", stderr: "inherit" });
  const output = await new Response(child.stdout).text();
  if (await child.exited !== 0) throw Error("Browser determinism gate failed; stop before runner implementation");
  const results = JSON.parse(output);
  const report = { schema: "first-stack-browser-determinism/1", bun: Bun.version,
    tool: "playwright@1.64.1", results, cases: cases.map(c => ({ name: c.name, seed: c.seed, canonicalHash: hash(c.expected.canonical), fingerprint: c.expected.fingerprint })) };
  await Bun.write(workerMode ? ".cache/browser-worker.json" : ".cache/browser-determinism.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally { server.stop(true); }
