import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Resource } from "@infraforge/domain/resource";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { compareInputs } from "../comparison/inputs";
import { classifyComparison } from "../comparison/classify";
import type { StoredRun } from "../reports/report";

const workload = { targetThroughput: 600, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 0.8, payloadSize: "light" as const };
function layout(count?: number) {
  const resources: Resource[] = [{ id: "app", type: "Virtual Machine", x: 0, y: 0 }, { id: "cache", type: "Cache", x: 1, y: 0 },
    { id: "db", type: "Database", x: 2, y: 0, ...(count === undefined ? {} : { dataKeyspace: { version: 1 as const, count } }) }];
  return { resources, connectionLines: [
    { id: "app-cache", sourceId: "app", targetId: "cache", sourceType: "Virtual Machine", targetType: "Cache", port: 6379 },
    { id: "cache-db", sourceId: "cache", targetId: "db", sourceType: "Cache", targetType: "Database", port: 5432 },
  ] };
}

test("hot-key layout/capture schemas retain explicit intent and bound the optional pattern", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) for (const accessPattern of ["uniform", "hot-key"] as const) {
    const d = layout(100); d.resources[2]!.dataKeyspace!.accessPattern = accessPattern;
    expect(schema.parse(JSON.parse(JSON.stringify(d))).resources[2]!.dataKeyspace).toEqual({ version: 1, count: 100, accessPattern });
  }
  for (const accessPattern of [null, "zipf", "", 80, {}, []]) {
    const d = layout(100); Object.assign(d.resources[2]!.dataKeyspace!, { accessPattern });
    for (const schema of [LayoutSchema, LiveTopologySchema]) expect(schema.safeParse(d).success).toBe(false);
  }
  const d = layout(100); d.resources[2]!.dataKeyspace!.accessPattern = "hot-key";
  const input = captureRunInputs(d, workload, "hot-capture"), stored = readRunInputs(JSON.parse(JSON.stringify(input)));
  expect(input.adapterProfiles).toEqual(["data-keyspace/1", "data-hot-key/1"]);
  expect(JSON.stringify(stored)).toBe(JSON.stringify(input));
  expect(buildContractFromRunInputs({ ...stored, adapterProfiles: ["data-keyspace/1"] }, 5)).toHaveProperty("refused");
  expect(buildContractFromRunInputs({ ...stored, adapterProfiles: undefined }, 5)).toHaveProperty("refused");
  d.resources[2]!.dataKeyspace!.count = 1;
  const one = captureRunInputs(d, workload, "hot-capture"), historical = captureRunInputs(layout(), workload, "hot-capture");
  expect(one.adapterProfiles).toEqual([]); expect(buildContractFromRunInputs(one, 5)).toEqual(buildContractFromRunInputs(historical, 5));
});

test("layout and live topology schemas retain strict versioned DB keyspaces and refuse invalid bounds", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) {
    for (const count of [1, 10, 1000]) expect(schema.parse(JSON.parse(JSON.stringify(layout(count)))).resources[2]!.dataKeyspace).toEqual({ version: 1, count });
    for (const count of [0, -1, 1.1, 1001, NaN, Infinity]) expect(schema.safeParse(layout(count)).success).toBe(false);
    for (const value of [null, {}, { version: 2, count: 10 }, { version: 1, count: 10, skew: "hot" }]) {
      const bad = layout(); Object.assign(bad.resources[2]!, { dataKeyspace: value }); expect(schema.safeParse(bad).success).toBe(false);
    }
    const wrongOwner = layout(); wrongOwner.resources[1]!.dataKeyspace = { version: 1, count: 10 };
    expect(schema.safeParse(wrongOwner).success).toBe(false);
  }
});

test("only new multi-key captures persist data-keyspace/1; old inputs remain without implicit profiles", () => {
  const old = captureRunInputs(layout(), workload, "keyspace-parity"), one = captureRunInputs(layout(1), workload, "keyspace-parity");
  expect(old.adapterProfiles).toEqual([]); expect(one.adapterProfiles).toEqual([]);
  expect(buildContractFromRunInputs(old, 5)).toEqual(buildContractFromRunInputs(one, 5));
  const historical = { ...old, adapterProfiles: undefined };
  expect(readRunInputs(JSON.parse(JSON.stringify(historical))).adapterProfiles).toBeUndefined();
  expect(buildContractFromRunInputs(historical, 5)).toEqual(buildContractFromRunInputs(old, 5));
  const captured = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout(10), workload, "keyspace-parity"))));
  expect(captured.adapterProfiles).toEqual(["data-keyspace/1"]);
  expect(captured.resources[2]!.dataKeyspace).toEqual({ version: 1, count: 10 });
  expect(buildContractFromRunInputs({ ...captured, adapterProfiles: undefined }, 5)).toHaveProperty("refused");
  expect(buildContractFromRunInputs({ ...old, adapterProfiles: ["data-keyspace/1"] }, 5)).toHaveProperty("refused");
});

for (const pattern of [undefined, "uniform", "hot-key"] as const) for (const flow of [false, true]) test(`saved multi-key browser/server contracts, evidence and views agree, flow=${flow}, pattern=${pattern}`, () => {
  const d = layout(10);
  if (pattern) d.resources[2]!.dataKeyspace!.accessPattern = pattern;
  if (flow) d.resources[0]!.applicationFlow = { schema: "application-flow/2", operations: {
    read: { steps: [{ id: "read", kind: "data", edge: "app-cache", operation: "read" }] },
    write: { steps: [{ id: "write", kind: "data", edge: "app-cache", operation: "write" }] },
  } };
  const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(d, workload, "keyspace-parity"))));
  const browserContract = buildContractFromRunInputs(input, 5), serverContract = buildContractFromRunInputs(input, 5, buildModel2Contract);
  expect(browserContract).toHaveProperty("contract"); expect(browserContract).toEqual(serverContract);
  const browser = createModel2Run(input, 5), server = createModel2Engine(input, 5, buildModel2Contract);
  for (let i = 0; i < 5; i++) {
    browser.advance(); server.advance();
    expect(browser.evidence()).toEqual(server.evidence());
    expect(browser.view()).toEqual(server.view());
  }
  const e = browser.evidence();
  expect(new Set(e.data.applications[0]!.results.map(r => r.key)).size).toBeGreaterThan(1);
  expect(e.data.databases[0]!.rows).toHaveLength(10);
  expect(browser.view().metrics.db!.memory).toBeNull();
  if (pattern === "hot-key") {
    const keys = e.data.applications[0]!.results.map(r => r.key);
    expect(keys.filter(k => k === "key-1").length / keys.length).toBeGreaterThan(0.65);
    const repeated = createModel2Run(input, 5); for (let i = 0; i < 5; i++) repeated.advance();
    expect(repeated.evidence()).toEqual(e);
  }
});

test("browser-target compiled runtime replays saved uniform and hot-key inputs like the server", async () => {
  const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts")], target: "browser" });
  expect(built.success).toBe(true);
  // Windows Bun treats large data URLs as paths; load the browser bundle from the ignored worktree cache.
  const browserPath = resolve(import.meta.dir, `../../../.cache/hot-key-browser-${process.pid}.mjs`);
  await mkdir(dirname(browserPath), { recursive: true }); await Bun.write(browserPath, built.outputs[0]!);
  try {
    const browserModule = await import(pathToFileURL(browserPath).href);
    const createBrowserRun: typeof createModel2Run = browserModule.createModel2Run;
    for (const accessPattern of ["uniform", "hot-key"] as const) {
      const d = layout(100); d.resources[2]!.dataKeyspace!.accessPattern = accessPattern;
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(d, workload, "compiled-hot-parity"))));
      const browser = createBrowserRun(input, 5), server = createModel2Engine(input, 5, buildModel2Contract);
      for (let i = 0; i < 5; i++) {
        browser.advance(); server.advance();
        expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view());
      }
    }
  } finally { await unlink(browserPath); }
});

test("comparison retains keyspace edits and treats replay profile changes as descriptive only", () => {
  const old = captureRunInputs(layout(), workload, "same"), ten = captureRunInputs(layout(10), workload, "same"), hundred = captureRunInputs(layout(100), workload, "same");
  expect(compareInputs(old, ten)).toMatchObject({ grade: "side-by-side-only", facets: { adapterProfiles: "different", topology: "different" } });
  expect(compareInputs(ten, hundred)).toMatchObject({ grade: "one-change-design", design: { reconfigured: [{ id: "db", fields: [{ field: "dataKeyspace" }] }] } });
  const at = new Date("2026-11-01T00:00:00Z");
  const row = (id: string, runInputs: typeof old): StoredRun => ({ id, infrastructureId: "design", runName: id, status: "torn-down", resourceCount: 3,
    createdAt: at, updatedAt: at, topologyRevision: 0, stages: [], timeline: [], chaosEvents: [], workloadProfile: runInputs.workloadProfile, seed: runInputs.seed,
    simulationState: null, runInputs, liveTopology: layout(), terminalSnapshot: null, actions: [], actionCount: 0 });
  expect(classifyComparison(row("a", old), row("b", ten)).headline).toBe("descriptive-only");
});
