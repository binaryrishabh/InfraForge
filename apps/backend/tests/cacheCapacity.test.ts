import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CachePolicy } from "@infraforge/domain/resource";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { keyspaceDesign } from "../../../packages/simulation/tests/keyspace.fixture";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { compareInputs } from "../comparison/inputs";

function layout(policy?: CachePolicy, hot = false, flow = false) {
  const d = keyspaceDesign(10);
  if (policy) d.resources[1]!.cachePolicy = policy;
  if (hot) d.resources[2]!.dataKeyspace!.accessPattern = "hot-key";
  if (flow) d.resources[0]!.applicationFlow = { schema: "application-flow/2", operations: { read: { steps: [{ id: "read", kind: "data", edge: "edge-0", operation: "read" }] } } };
  return { resources: d.resources, connectionLines: d.connections };
}
const workload = { ...keyspaceDesign().workload, readWriteRatio: 1 };

test("layout/live/captured schemas retain bounded version 2 capacity and reject version 1 extensions", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) {
    for (const capacityEntries of [1, 10, 100, 1000]) {
      const policy: CachePolicy = { version: 2, capacityEntries, ttlSeconds: 1, singleFlight: true };
      const parsed = schema.parse(JSON.parse(JSON.stringify(layout(policy))));
      expect(parsed.resources[1]!.cachePolicy).toEqual(policy);
      expect(readRunInputs(captureRunInputs(parsed, workload, "capacity-schema")).resources[1]!.cachePolicy).toEqual(policy);
    }
    for (const policy of [{ version: 1, capacityEntries: 10 }, { version: 2 }, ...[0, -1, 1.5, 1001, null, "10", NaN, Infinity].map(capacityEntries => ({ version: 2, capacityEntries }))]) {
      const d = layout(); Object.assign(d.resources[1]!, { cachePolicy: policy });
      expect(schema.safeParse(d).success).toBe(false); expect(() => captureRunInputs(d, workload, "bad-capacity")).toThrow();
    }
    const d = layout(); d.resources[2]!.cachePolicy = { version: 2, capacityEntries: 10 };
    expect(schema.safeParse(d).success).toBe(false);
  }
});

test("new captures select capacity profile only with saved capacity; missing/mismatched historical profiles refuse", () => {
  const old = captureRunInputs(layout(), workload, "capacity-capture");
  expect(old.adapterProfiles).toEqual(["data-keyspace/1"]);
  expect(buildContractFromRunInputs({ ...old, adapterProfiles: [...old.adapterProfiles!, "data-cache-capacity/1"] }, 5)).toHaveProperty("refused");
  for (const policy of [{ version: 2 as const, capacityEntries: 10 }, { version: 2 as const, capacityEntries: 1000, ttlSeconds: 1, singleFlight: true }]) {
    const captured = captureRunInputs(layout(policy), workload, "capacity-capture"), saved = readRunInputs(JSON.parse(JSON.stringify(captured)));
    expect(saved).toEqual(captured); expect(saved.adapterProfiles).toContain("data-cache-capacity/1");
    expect(saved.adapterProfiles!.includes("data-cache-policy/1")).toBe(policy.singleFlight === true);
    expect(buildContractFromRunInputs(saved, 5)).toHaveProperty("contract");
    for (const adapterProfiles of [undefined, [], ["data-keyspace/1" as const]]) expect(buildContractFromRunInputs({ ...saved, adapterProfiles }, 5)).toHaveProperty("refused");
    expect(() => readRunInputs({ ...saved, adapterProfiles: [...saved.adapterProfiles!, "data-cache-capacity/1"] })).toThrow();
  }
});

for (const hot of [false, true]) for (const flow of [false, true]) test(`browser/server capacity compilation and replay agree: hot=${hot}, flow=${flow}`, () => {
  const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout({ version: 2, capacityEntries: 2, ttlSeconds: 1, singleFlight: true }, hot, flow), workload, "capacity-parity"))));
  expect(buildContractFromRunInputs(input, 5)).toEqual(buildContractFromRunInputs(input, 5, buildModel2Contract));
  const browser = createModel2Run(input, 5), server = createModel2Engine(input, 5, buildModel2Contract);
  for (let i = 0; i < 5; i++) { browser.advance(); server.advance(); expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view()); }
  expect(browser.evidence().data.caches[0]!.capacityBytes).toBe(2176);
  expect(browser.evidence().data.caches[0]!.evictions).toBeGreaterThan(0);
});

test("browser-target bundle replays capacity pressure identically to server with TTL and single-flight", async () => {
  const browserPath = resolve(import.meta.dir, `../../../.cache/cache-capacity-browser-${process.pid}.mjs`);
  await mkdir(dirname(browserPath), { recursive: true });
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(), exitCode = await build.exited;
    if (exitCode !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    const browserModule = await import(pathToFileURL(browserPath).href);
    const createBrowserRun: typeof createModel2Run = browserModule.createModel2Run;
    for (const hot of [false, true]) for (const singleFlight of [false, true]) {
      const d = layout({ version: 2, capacityEntries: 2, ttlSeconds: 1, singleFlight }, hot); d.resources[0]!.size = "large";
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(d, { ...workload, targetThroughput: 60000 }, "capacity-bundle-parity"))));
      const browser = createBrowserRun(input, 5), server = createModel2Engine(input, 5, buildModel2Contract);
      for (let i = 0; i < 5; i++) { browser.advance(); server.advance(); expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view()); }
      const e = browser.evidence(), c = e.data.caches[0]!, a = e.data.applications[0]!;
      expect(c.evictions).toBeGreaterThan(0); expect(c.capacityBytes).toBe(2176);
      if (singleFlight) expect(a.coalescedWaiters).toBeGreaterThan(0); else expect(a.coalescedWaiters).toBe(0);
      console.info("cache-capacity-browser-parity", JSON.stringify({ hot, singleFlight, evictions: c.evictions, expirations: c.expirations, reads: e.data.databases[0]!.logicalReads, waiters: a.coalescedWaiters }));
    }
  } finally { if (await Bun.file(browserPath).exists()) await unlink(browserPath); }
});

test("capacity changes remain visible in saved-design comparisons", () => {
  const a = captureRunInputs(layout({ version: 2, capacityEntries: 10 }), workload, "same"), b = captureRunInputs(layout({ version: 2, capacityEntries: 100 }), workload, "same");
  expect(compareInputs(a, b)).toMatchObject({ grade: "one-change-design", design: { reconfigured: [{ id: "cache", fields: [{ field: "cachePolicy" }] }] } });
});
