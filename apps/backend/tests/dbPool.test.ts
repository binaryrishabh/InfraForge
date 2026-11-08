import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs, compileProduct, requireKnown } from "@infraforge/simulation/internal-product";
import { boundFunctionPoolPressureV1 } from "../challenges/definitions/bound-function-pool-pressure/v1";
import { starter } from "../challenges/starter";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
const workload = {targetThroughput: 60000, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 1, payloadSize: "light" as const};
const layout = (value?: number) => starter([["app", "Virtual Machine", 0, 0, {skuId: "m5.2xlarge"}], ["db", "Database", 1, 0, {skuId: "db.m5.large", ...(value === undefined ? {} : {dbPoolMaxConnections: value})}]], [["app", "db"]]);
test("saved/live/captured pool intent is bounded, owned and preserved by JSON reload", () => {
 for (const schema of [LayoutSchema, LiveTopologySchema]) {
  for (const value of [undefined, 1, 10, 512]) {
   const parsed = schema.parse(JSON.parse(JSON.stringify(layout(value))));
   expect(parsed.resources[1]!.dbPoolMaxConnections).toBe(value);
   expect(readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(parsed, workload, "pool"))))).toEqual(captureRunInputs(parsed, workload, "pool"));
  }
  for (const value of [null, "2", {}, [], 0, -1, 1.5, 513, NaN, Infinity]) {
   const s = layout(); Object.assign(s.resources[1]!, {dbPoolMaxConnections: value});
   expect(schema.safeParse(s).success).toBe(false); expect(() => captureRunInputs(s, workload, "pool")).toThrow();
  }
  const s = layout(); s.resources[0]!.dbPoolMaxConnections = 2; expect(schema.safeParse(s).success).toBe(false);
 }
});
test("profiles and compiled bindings refuse missing, mismatched and tampered pool intent", () => {
 for (const value of [1, 10, 512]) {
  const input = captureRunInputs(layout(value), workload, "pool"), b = buildContractFromRunInputs(input, 2);
  expect(input.adapterProfiles).toContain("data-db-pool/1");
  expect(buildContractFromRunInputs({...input, adapterProfiles: input.adapterProfiles!.filter(p => p !== "data-db-pool/1")}, 2)).toHaveProperty("refused");
  expect(() => readRunInputs({...input, adapterProfiles: [...input.adapterProfiles!, "data-db-pool/1"]})).toThrow();
  if ("refused" in b) throw Error(JSON.stringify(b.refused));
  const design = {schema: "infraforge-saved-design/1" as const, resources: input.resources, connections: input.connectionLines, workload: input.workloadProfile};
  const compiled = compileProduct(design, b.contract); if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const path = compiled.value.input.paths.find(p => p.target === "db")!;
  expect(requireKnown(path.pool.maxConnections, "count")).toBe(value);
  const db = compiled.value.input.resources.find(r => r.id === "db")!; if (db.kind !== "relational") throw Error("expected DB");
  expect(requireKnown(db.maxSessions, "count")).toBe(680); expect(requireKnown(db.activeTransactions, "count")).toBe(32);
  const tampered = structuredClone(b.contract); tampered.edges["app-db"]!.transport = "database";
  if (value !== 10) expect(compileProduct(design, tampered).ok).toBe(false);
  const malformed = structuredClone(design); malformed.resources[1]!.dbPoolMaxConnections = 0;
  expect(compileProduct(malformed, b.contract).ok).toBe(false);
 }
 const old = captureRunInputs(layout(), workload, "old");
 expect(old.adapterProfiles).not.toContain("data-db-pool/1");
 expect(buildContractFromRunInputs({...old, adapterProfiles: [...old.adapterProfiles!, "data-db-pool/1"]}, 2)).toHaveProperty("refused");
});
test("each replica and cache-aside path uses the target maximum without changing caller/cache pools", () => {
 for (const cache of [false, true]) {
  const s = layout(7);
  s.resources.unshift({id: "lb", type: "Load Balancer", x: 0, y: 0, autoscaling: {enabled: true, minReplicas: 3, maxReplicas: 3, targetCpu: 80}});
  s.connectionLines.unshift({id: "lb-app", sourceId: "lb", targetId: "app", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80});
  if (cache) {
   s.resources.push({id: "cache", type: "Cache", x: 0, y: 0});
   s.connectionLines[1] = {id: "app-cache", sourceId: "app", targetId: "cache", sourceType: "Virtual Machine", targetType: "Cache", port: 6379};
   s.connectionLines.push({id: "cache-db", sourceId: "cache", targetId: "db", sourceType: "Cache", targetType: "Database", port: 5432});
  }
  const input = captureRunInputs(s, workload, "owners"), b = buildContractFromRunInputs(input, 1); if ("refused" in b) throw Error(JSON.stringify(b.refused));
  const c = compileProduct({schema: "infraforge-saved-design/1", resources: input.resources, connections: input.connectionLines, workload: input.workloadProfile}, b.contract); if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const paths = c.value.input.paths.filter(p => p.target === "db"); expect(paths.length).toBe(cache ? 1 : 3);
  for (const p of paths) expect(requireKnown(p.pool.maxConnections, "count")).toBe(7);
  expect(requireKnown(c.value.input.paths.find(p => p.source === "$caller")!.pool.maxConnections, "count")).toBe(512);
  for (const p of c.value.input.paths.filter(p => p.target === "cache")) expect(requireKnown(p.pool.maxConnections, "count")).toBe(32);
 }
});
test("function instances share their source path; separate databases retain distinct maxima", () => {
 const fn = structuredClone(boundFunctionPoolPressureV1.starter!); fn.resources.find(r => r.id === "db")!.dbPoolMaxConnections = 7;
 const two = starter([["lb", "Load Balancer", 0, 0], ["app", "Virtual Machine", 1, 0], ["peer", "Virtual Machine", 1, 1],
  ["db", "Database", 2, 0, {dbPoolMaxConnections: 1}], ["other", "Database", 2, 1, {dbPoolMaxConnections: 7}]],
  [["lb", "app"], ["lb", "peer"], ["app", "db"], ["peer", "other"]]);
 for (const [s, w] of [[fn, boundFunctionPoolPressureV1.workload], [two, workload]] as const) {
  const input = captureRunInputs(s, w, "owners"), b = buildContractFromRunInputs(input, 1); if ("refused" in b) throw Error(JSON.stringify(b.refused));
  const c = compileProduct({schema: "infraforge-saved-design/1", resources: input.resources, connections: input.connectionLines, workload: input.workloadProfile}, b.contract); if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  for (const r of s.resources.filter(r => r.type === "Database")) {
   const paths = c.value.input.paths.filter(p => p.target === r.id); expect(paths).toHaveLength(1);
   expect(requireKnown(paths[0]!.pool.maxConnections, "count")).toBe(r.dbPoolMaxConnections!);
  }
 }
});
test("browser-target bundle and server replay agree at several pool maxima", async () => {
 const file = resolve(import.meta.dir, `../../../.cache/db-pool-browser-${process.pid}.mjs`); await mkdir(dirname(file), {recursive: true});
 try {
  const built = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", file], {stdout: "ignore", stderr: "pipe"});
  const errors = await new Response(built.stderr).text(); if (await built.exited) throw Error(errors);
  const module = await import(pathToFileURL(file).href), browserRun: typeof createModel2Run = module.createModel2Run;
  for (const value of [1, 2, 10, 512]) {
   const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout(value), workload, "challenge:size-the-app-database-pool:v1"))));
   expect(buildContractFromRunInputs(input, 6)).toEqual(buildContractFromRunInputs(input, 6, buildModel2Contract));
   const browser = browserRun(input, 6), server = createModel2Engine(input, 6, buildModel2Contract);
   for (let i = 0; i < 6; i++) { browser.advance(); server.advance(); expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view()); }
   const p = browser.evidence().network.paths.find(p => p.target === "db")!;
   expect(p.pool.connections).toBeLessThanOrEqual(value); expect(p.pool.acquired - p.pool.released).toBe(p.pool.activeStreams);
  }
 } finally { if (await Bun.file(file).exists()) await unlink(file); }
}, 120000);
