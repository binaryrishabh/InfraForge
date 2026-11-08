import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildContractFromRunInputs, compileProduct, contractFromDesign, requireKnown } from "@infraforge/simulation/internal-product";
import type { createModel2Run } from "@infraforge/simulation/model2-run";
import { LayoutSchema } from "../zod_schemas/layout.schema";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { readRecords } from "../reports/records";
import { buildRunReport } from "../reports/report";
import { answers, attemptRow, definition } from "./challengeHarness";

const d = definition("writes-cost-more-than-reads");
function design(size?: "small" | "medium" | "large", skuId?: string, resourceId = "db") {
  const value = structuredClone(d.starter!);
  Object.assign(value.resources.find(r => r.id === resourceId)!, { size, skuId });
  return value;
}
function compiled(size?: "small" | "medium" | "large", skuId?: string, resourceId = "db") {
  const input = captureRunInputs(design(size, skuId, resourceId), d.workload, challengeSeed(d));
  const built = buildContractFromRunInputs(input, d.evaluationSeconds);
  if ("refused" in built) throw Error(built.refused.join(" "));
  const result = compileProduct({ schema: "infraforge-saved-design/1", resources: input.resources,
    connections: input.connectionLines, workload: input.workloadProfile }, built.contract);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  const resource = result.value.input.resources.find(r => r.id === resourceId)!;
  if (resource.kind !== "relational" && resource.kind !== "compute") throw Error("Expected sizeable resource");
  return requireKnown(resource.kind === "compute" ? resource.cores : resource.execution.cores, "cores");
}

test("generic sizes validate, survive layout/input JSON and compile unchanged; catalog CPU wins over size", () => {
  for (const [size, cores] of [[undefined, 1], ["small", 1], ["medium", 2], ["large", 4]] as const) {
    const saved = LayoutSchema.parse(JSON.parse(JSON.stringify(design(size))));
    const input = captureRunInputs(saved, d.workload, challengeSeed(d));
    expect(readRunInputs(JSON.parse(JSON.stringify(input)))).toEqual(input);
    expect(input.resources.find(r => r.id === "db")!.size).toBe(size);
    expect(compiled(size)).toBe(cores);
    expect(compiled(size, undefined, "app")).toBe(cores);
  }
  expect(compiled("large", "db.m5.large")).toBe(2);
  expect(compiled("large", "c5.large", "app")).toBe(2);
  const both = design("large", "db.m5.large");
  const described = contractFromDesign({ schema: "infraforge-saved-design/1", resources: both.resources, connections: both.connectionLines, workload: d.workload });
  if ("refused" in described) throw Error("Expected supported sizing");
  expect(described.assumptions.find(e => e.id === "db.sizing")?.sentence).toContain("Catalog CPU and memory labels");
  const bad = design("small");
  Object.assign(bad.resources.find(r => r.id === "db")!, { size: "extra-large" });
  expect(LayoutSchema.safeParse(bad).success).toBe(false);
  expect(() => captureRunInputs(bad, d.workload)).toThrow("layout is invalid");
  expect(() => readRunInputs({ ...captureRunInputs(design("small"), d.workload), resources: bad.resources })).toThrow("missing or unsupported");
});

test("small to medium changes real database outcomes; saved reports retain inputs and report the measured result", () => {
  const small = design("small"), medium = design("medium");
  expect({ ...medium, resources: medium.resources.map(r => r.id === "db" ? { ...r, size: "small" } : r) }).toEqual(small);
  const reports = [small, medium].map(value => {
    const row = attemptRow(d, value, answers(d, { "busiest-type": "Database" }));
    const stored = JSON.parse(JSON.stringify(row.runInputs));
    expect(readRecords({ ...row, runInputs: stored }, []).input).toEqual(row.runInputs);
    const report = buildRunReport({ ...row, runInputs: stored });
    // Existing report summary omits generic size; retained runInputs are authoritative.
    expect(report.topology.original!.resources.find(r => r.id === "db")).not.toHaveProperty("size");
    return report;
  });
  expect(reports.map(r => r.challenge?.status)).toEqual(["not-met", "met"]);
  const [before, after] = reports.map(r => ({ p95: r.terminal!.traffic!.latencyMs.p95!,
    cpu: r.terminal!.resources.find(resource => resource.id === "db")!.cpu!,
    completedRps: r.terminal!.traffic!.completedRps }));
  expect(before!.p95).toBeGreaterThan(200);
  expect(after!.p95).toBeLessThan(20);
  expect(after!.cpu).toBeLessThan(before!.cpu * 0.6);
  console.info(JSON.stringify({ genericDatabaseSizing: { second: 12, before, after } }));
}, 120000);

test("generic sizes and a legacy size-plus-SKU state replay identically in browser target and server", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/generic-sizing-replay-${process.pid}.mjs`);
  await mkdir(dirname(path), { recursive: true });
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text();
    if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const value of [design("small"), design("medium"), design("large"), design("large", "db.m5.large")]) {
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(value, d.workload, challengeSeed(d)))));
      const browser = browserRun(input, d.evaluationSeconds), server = createModel2Engine(input, d.evaluationSeconds);
      for (let second = 1; second <= d.evaluationSeconds; second++) {
        browser.advance(); server.advance();
        expect(browser.view()).toEqual(server.view());
        expect(browser.evidence()).toEqual(server.evidence());
      }
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
}, 180000);
