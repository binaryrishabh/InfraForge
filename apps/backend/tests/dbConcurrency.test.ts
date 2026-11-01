import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Resource, DbConcurrency } from "@infraforge/domain/resource";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { compareInputs } from "../comparison/inputs";

function layout(dbConcurrency?: DbConcurrency, hot = false, cache = false, flow = false) {
  const resources: Resource[] = [
    { id: "app", type: "Virtual Machine", x: 0, y: 0, size: "large" },
    { id: "db", type: "Database", x: 2, y: 0, size: "large", dataKeyspace: { version: 1, count: 10, ...(hot ? { accessPattern: "hot-key" } : {}) }, ...(dbConcurrency ? { dbConcurrency } : {}) },
  ];
  const connectionLines = [{ id: "edge-0", sourceId: "app", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432 }];
  if (cache) {
    resources.push({ id: "cache", type: "Cache", x: 1, y: 0, cachePolicy: { version: 2, capacityEntries: 2, ttlSeconds: 1, singleFlight: true } });
    connectionLines[0] = { ...connectionLines[0]!, targetId: "cache", targetType: "Cache", port: 6379 };
    connectionLines.push({ id: "edge-1", sourceId: "cache", targetId: "db", sourceType: "Cache", targetType: "Database", port: 5432 });
  }
  if (flow) resources[0]!.applicationFlow = { schema: "application-flow/2", operations: { read: { steps: [{ id: "read", kind: "data", edge: "edge-0", operation: "read" }] } } };
  return { resources, connectionLines };
}
const workload = { targetThroughput: 72000, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 1, payloadSize: "light" as const };

test("layout/live/captured schemas preserve partial bounded execution limits and reject malformed intent", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) {
    for (const dbConcurrency of [{ version: 1 as const }, { version: 1 as const, activeQueries: 1 }, { version: 1 as const, queuedQueries: 0 }, { version: 1 as const, activeQueries: 512, queuedQueries: 1000 }]) {
      const parsed = schema.parse(JSON.parse(JSON.stringify(layout(dbConcurrency))));
      expect(parsed.resources[1]!.dbConcurrency).toEqual(dbConcurrency);
      expect(readRunInputs(captureRunInputs(parsed, workload, "query-schema")).resources[1]!.dbConcurrency).toEqual(dbConcurrency);
    }
    for (const value of [null, [], {}, { version: 2 }, { version: 1, sessions: 10 }, ...[0, -1, 1.5, 513, null, "1", NaN, Infinity].map(activeQueries => ({ version: 1, activeQueries })), ...[-1, 1.5, 1001, null, "1", NaN, Infinity].map(queuedQueries => ({ version: 1, queuedQueries }))]) {
      const d = layout(); Object.assign(d.resources[1]!, { dbConcurrency: value });
      expect(schema.safeParse(d).success).toBe(false); expect(() => captureRunInputs(d, workload, "bad-query-limit")).toThrow();
    }
    const wrongOwner = layout(); wrongOwner.resources[0]!.dbConcurrency = { version: 1, activeQueries: 1 };
    expect(schema.safeParse(wrongOwner).success).toBe(false);
  }
});

test("capture opts in only for explicit query limits; missing, duplicate and mismatched profiles refuse", () => {
  const old = captureRunInputs(layout(), workload, "query-capture"); expect(old.adapterProfiles).toEqual(["data-keyspace/1"]);
  expect(buildContractFromRunInputs({ ...old, adapterProfiles: [...old.adapterProfiles!, "data-db-concurrency/1"] }, 5)).toHaveProperty("refused");
  for (const setting of [{ version: 1 as const, activeQueries: 1 }, { version: 1 as const, queuedQueries: 0 }, { version: 1 as const, activeQueries: 8, queuedQueries: 2 }]) {
    const captured = captureRunInputs(layout(setting), workload, "query-capture"), saved = readRunInputs(JSON.parse(JSON.stringify(captured)));
    expect(saved).toEqual(captured); expect(saved.adapterProfiles).toContain("data-db-concurrency/1");
    expect(buildContractFromRunInputs(saved, 5)).toHaveProperty("contract");
    for (const adapterProfiles of [undefined, [], ["data-keyspace/1" as const]]) expect(buildContractFromRunInputs({ ...saved, adapterProfiles }, 5)).toHaveProperty("refused");
    expect(() => readRunInputs({ ...saved, adapterProfiles: [...saved.adapterProfiles!, "data-db-concurrency/1"] })).toThrow();
  }
});

for (const hot of [false, true]) for (const cache of [false, true]) test(`browser/server query compilation and replay agree: hot=${hot}, cache=${cache}`, () => {
  const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout({ version: 1, activeQueries: 1, queuedQueries: 2 }, hot, cache, true), workload, "query-parity"))));
  expect(buildContractFromRunInputs(input, 3)).toEqual(buildContractFromRunInputs(input, 3, buildModel2Contract));
  const browser = createModel2Run(input, 3), server = createModel2Engine(input, 3, buildModel2Contract);
  for (let i = 0; i < 3; i++) { browser.advance(); server.advance(); expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view()); }
  expect(browser.evidence().data.databases[0]!.transactions.admitted).toBeGreaterThan(0);
});

test("browser-target bundle and server replay agree under query limits with hot keys, cache eviction and single-flight", async () => {
  const browserPath = resolve(import.meta.dir, `../../../.cache/db-query-browser-${process.pid}.mjs`);
  await mkdir(dirname(browserPath), { recursive: true });
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(), exitCode = await build.exited;
    if (exitCode !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    const browserModule = await import(pathToFileURL(browserPath).href), createBrowserRun: typeof createModel2Run = browserModule.createModel2Run;
    for (const hot of [false, true]) for (const cache of [false, true]) {
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout({ version: 1, activeQueries: 1, queuedQueries: 0 }, hot, cache), workload, "query-bundle-parity"))));
      const browser = createBrowserRun(input, 3), server = createModel2Engine(input, 3, buildModel2Contract);
      for (let i = 0; i < 3; i++) { browser.advance(); server.advance(); expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view()); }
      const e = browser.evidence(), db = e.data.databases[0]!;
      expect(db.transactions.admitted).toBeGreaterThan(0);
      if (!cache) expect(db.reasons["query-queue-full"]!).toBeGreaterThan(0);
      else { expect(e.data.caches[0]!.evictions).toBeGreaterThan(0); expect(e.data.applications[0]!.coalescedWaiters).toBeGreaterThan(0); }
      console.info("db-query-browser-parity", JSON.stringify({ hot, cache, reads: db.logicalReads, refusals: db.reasons["query-queue-full"] ?? 0, evictions: e.data.caches[0]?.evictions, coalesced: e.data.applications[0]?.coalescedWaiters }));
    }
  } finally { if (await Bun.file(browserPath).exists()) await unlink(browserPath); }
});

test("saved concurrency changes remain visible in one-change comparisons", () => {
  const a = captureRunInputs(layout({ version: 1, activeQueries: 1, queuedQueries: 2 }), workload, "same"), b = captureRunInputs(layout({ version: 1, activeQueries: 8, queuedQueries: 2 }), workload, "same");
  expect(compareInputs(a, b)).toMatchObject({ grade: "one-change-design", design: { reconfigured: [{ id: "db", fields: [{ field: "dbConcurrency" }] }] } });
});

test("saved canvas query slots change real DB waiting and live latency under the same steady load", () => {
  const outcomes = [1, 8].map(activeQueries => {
    const input = captureRunInputs(layout({ version: 1, activeQueries, queuedQueries: 32 }), workload, "query-live-comparison");
    const run = createModel2Run(input, 3);
    for (let i = 0; i < 3; i++) run.advance();
    const e = run.evidence(), db = e.data.databases[0]!, view = run.view();
    return { activeQueries, queued: db.queued, completed: e.counts.completed, p95Ms: view.traffic.latencyMs.p95, refusals: db.reasons["query-queue-full"] ?? 0, sessionRefusals: db.sessionEvents?.refused };
  });
  expect(outcomes[0]!.queued).toBeGreaterThan(0); expect(outcomes[1]!.queued).toBe(0);
  expect(outcomes[0]!.p95Ms).not.toBeNull(); expect(outcomes[1]!.p95Ms).not.toBeNull();
  expect(outcomes[0]!.p95Ms!).toBeGreaterThan(outcomes[1]!.p95Ms!);
  expect(outcomes[1]!.completed).toBeGreaterThan(outcomes[0]!.completed);
  for (const result of outcomes) { expect(result.refusals).toBe(0); expect(result.sessionRefusals).toBe(0); }
  console.info("db-query-live-comparison", JSON.stringify(outcomes));
});
