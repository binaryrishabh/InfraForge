import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Resource, CachePolicy } from "@infraforge/domain/resource";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { compareInputs } from "../comparison/inputs";

const workload = { targetThroughput: 600, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 1, payloadSize: "light" as const };
function layout(cachePolicy?: CachePolicy, hot = false, flow = false) {
  const resources: Resource[] = [{ id: "app", type: "Virtual Machine", x: 0, y: 0 },
    { id: "cache", type: "Cache", x: 1, y: 0, ...(cachePolicy === undefined ? {} : { cachePolicy }) },
    { id: "db", type: "Database", x: 2, y: 0, ...(hot ? { dataKeyspace: { version: 1 as const, count: 10, accessPattern: "hot-key" as const } } : {}) }];
  if (flow) resources[0]!.applicationFlow = { schema: "application-flow/2", operations: { read: { steps: [{ id: "read", kind: "data", edge: "app-cache", operation: "read" }] } } };
  return { resources, connectionLines: [
    { id: "app-cache", sourceId: "app", targetId: "cache", sourceType: "Virtual Machine", targetType: "Cache", port: 6379 },
    { id: "cache-db", sourceId: "cache", targetId: "db", sourceType: "Cache", targetType: "Database", port: 5432 },
  ] };
}

test("layout, live topology and captured resources retain optional bounded cache settings", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) {
    expect(schema.parse(layout()).resources[1]).not.toHaveProperty("cachePolicy");
    for (const ttlSeconds of [1, 60, 3600]) for (const singleFlight of [false, true]) {
      const policy = { version: 1 as const, ttlSeconds, singleFlight };
      expect(schema.parse(JSON.parse(JSON.stringify(layout(policy)))).resources[1]!.cachePolicy).toEqual(policy);
    }
    for (const value of [null, [], {}, { version: 2 }, { version: 1, eviction: "lru" }, ...[0, -1, 1.1, 3601, NaN, Infinity, "60", null].map(ttlSeconds => ({ version: 1, ttlSeconds })), ...[0, "true", null].map(singleFlight => ({ version: 1, singleFlight }))]) {
      const bad = layout(); Object.assign(bad.resources[1]!, { cachePolicy: value });
      expect(schema.safeParse(bad).success).toBe(false);
      expect(() => captureRunInputs(bad, workload, "bounds")).toThrow();
    }
    const bad = layout(); bad.resources[2]!.cachePolicy = { version: 1, ttlSeconds: 1 };
    expect(schema.safeParse(bad).success).toBe(false);
  }
});

test("only new captures with changed compiled cache behavior select the cache policy profile", () => {
  const old = captureRunInputs(layout(), workload, "capture-cache"), historical = { ...old, adapterProfiles: undefined };
  expect(readRunInputs(JSON.parse(JSON.stringify(historical))).adapterProfiles).toBeUndefined();
  expect(buildContractFromRunInputs(historical, 5)).toEqual(buildContractFromRunInputs({ ...old, adapterProfiles: [] }, 5));
  for (const policy of [{ version: 1 as const }, { version: 1 as const, ttlSeconds: 60, singleFlight: false }]) {
    const saved = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout(policy), workload, "capture-cache"))));
    expect(saved.adapterProfiles).toEqual(["traffic-evidence/2"]); expect(saved.resources[1]!.cachePolicy).toEqual(policy);
    expect(buildContractFromRunInputs(saved, 5)).toEqual(buildContractFromRunInputs(old, 5));
  }
  for (const policy of [{ version: 1 as const, ttlSeconds: 1 }, { version: 1 as const, singleFlight: true }, { version: 1 as const, ttlSeconds: 120, singleFlight: true }]) {
    const captured = captureRunInputs(layout(policy), workload, "capture-cache");
    const saved = readRunInputs(JSON.parse(JSON.stringify(captured)));
    expect(JSON.stringify(saved)).toBe(JSON.stringify(captured));
    expect(saved.adapterProfiles).toEqual(["data-cache-policy/1", "traffic-evidence/2"]); expect(saved.resources[1]!.cachePolicy).toEqual(policy);
    expect(buildContractFromRunInputs(saved, 5)).toHaveProperty("contract");
    for (const adapterProfiles of [undefined, []]) expect(buildContractFromRunInputs({ ...saved, adapterProfiles }, 5)).toHaveProperty("refused");
  }
  expect(buildContractFromRunInputs({ ...old, adapterProfiles: ["data-cache-policy/1"] }, 5)).toHaveProperty("refused");
  expect(() => readRunInputs({ ...old, adapterProfiles: ["data-cache-policy/1", "data-cache-policy/1"] })).toThrow();
});

for (const hot of [false, true]) for (const flow of [false, true]) test(`saved cache policies replay identically in browser and server: hot=${hot}, flow=${flow}`, () => {
  const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout({ version: 1, ttlSeconds: 1, singleFlight: true }, hot, flow), workload, "cache-parity"))));
  expect(input.adapterProfiles).toContain("data-cache-policy/1");
  expect(buildContractFromRunInputs(input, 5)).toEqual(buildContractFromRunInputs(input, 5, buildModel2Contract));
  const browser = createModel2Run(input, 5), server = createModel2Engine(input, 5, buildModel2Contract);
  for (let i = 0; i < 5; i++) {
    browser.advance(); server.advance(); expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view());
  }
  expect(browser.evidence().data.caches[0]!.expirations).toBeGreaterThan(0);
});

test("browser-target bundle and server replay cache TTL and single-flight settings", async () => {
  const browserPath = resolve(import.meta.dir, `../../../.cache/cache-policy-browser-${process.pid}.mjs`);
  await mkdir(dirname(browserPath), { recursive: true });
  try {
    // Keep the new build isolated from other suites' in-process Bun resolver state on Windows.
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(), exitCode = await build.exited;
    if (exitCode !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    expect(exitCode).toBe(0);
    const browserModule = await import(pathToFileURL(browserPath).href);
    const createBrowserRun: typeof createModel2Run = browserModule.createModel2Run;
    for (const singleFlight of [false, true]) for (const hot of [false, true]) {
      const d = layout({ version: 1, ttlSeconds: 1, singleFlight }, hot); d.resources[0]!.size = "large";
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(d, { ...workload, targetThroughput: 60000 }, "compiled-cache-parity"))));
      const browser = createBrowserRun(input, 5), server = createModel2Engine(input, 5, buildModel2Contract);
      for (let i = 0; i < 5; i++) {
        browser.advance(); server.advance(); expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view());
      }
      const e = browser.evidence();
      expect(e.data.caches[0]!.expirations).toBeGreaterThan(0);
      if (singleFlight) expect(e.data.applications[0]!.coalescedWaiters).toBeGreaterThan(0);
      else expect(e.data.applications[0]!.coalescedWaiters).toBe(0);
      console.info("compiled-cache-parity", JSON.stringify({ hot, singleFlight, dbReads: e.data.databases[0]!.logicalReads, waiters: e.data.applications[0]!.coalescedWaiters, expirations: e.data.caches[0]!.expirations }));
    }
  } finally { if (await Bun.file(browserPath).exists()) await unlink(browserPath); }
});

test("comparison includes cache settings without upgrading descriptive profile comparisons", () => {
  const a = captureRunInputs(layout({ version: 1, ttlSeconds: 1 }), workload, "same"), b = captureRunInputs(layout({ version: 1, ttlSeconds: 120 }), workload, "same");
  expect(compareInputs(a, b)).toMatchObject({ grade: "one-change-design", design: { reconfigured: [{ id: "cache", fields: [{ field: "cachePolicy" }] }] } });
  const old = captureRunInputs(layout(), workload, "same");
  expect(compareInputs(old, a)).toMatchObject({ grade: "side-by-side-only", facets: { adapterProfiles: "different", topology: "different" } });
});
