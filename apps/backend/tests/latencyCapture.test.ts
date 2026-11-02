import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compileProduct, contractFromDesign } from "@infraforge/simulation/internal-product";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";

const layout = { resources: [{ id: "app", type: "Virtual Machine" as const, x: 0, y: 0 }], connectionLines: [] };
const workload = { targetThroughput: 600, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, payloadSize: "light" as const };
test("only new captures select traffic-evidence/2 once; readers and compilation never upgrade history", () => {
  const input = captureRunInputs(layout, workload, "latency-marker");
  expect(input.adapterProfiles).toEqual(["traffic-evidence/2"]);
  expect(readRunInputs(JSON.parse(JSON.stringify(input)))).toEqual(input);
  const old = { ...input, adapterProfiles: [] };
  expect(readRunInputs(old)).toEqual(old);
  const design = { schema: "infraforge-saved-design/1" as const, resources: input.resources, connections: input.connectionLines, workload: input.workloadProfile };
  const built = contractFromDesign(design, { adapterProfiles: [] }); if ("refused" in built) throw Error(JSON.stringify(built));
  expect(built.contract).not.toHaveProperty("trafficEvidenceProfile");
  const compiled = compileProduct(design, built.contract); if (!compiled.ok) throw Error(JSON.stringify(compiled));
  expect(compiled.value).not.toHaveProperty("trafficEvidenceProfile");
  expect(compiled.value.input).not.toHaveProperty("trafficEvidenceProfile");
  const duplicate = [...input.adapterProfiles!, "traffic-evidence/2" as const];
  expect(() => readRunInputs({ ...input, adapterProfiles: duplicate })).toThrow();
  expect(contractFromDesign(design, { adapterProfiles: duplicate })).toHaveProperty("refused");
  for (const marked of [false, true]) {
    const run = createModel2Run(marked ? input : old, 3);
    expect(Object.hasOwn(run.view().traffic.latencyMs, "p99")).toBe(marked);
    run.advance();
    expect(Object.hasOwn(run.view().traffic.latencyMs, "p99")).toBe(marked);
    if (marked) expect(run.view().traffic.latencyMs.p99).toBeGreaterThan(0);
  }
});

test("default Steady marker view agrees in browser target and server replay", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/latency-marker-${process.pid}.mjs`);
  await mkdir(dirname(path), { recursive: true });
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserRun: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    const input = captureRunInputs(layout, workload, "latency-marker");
    const browser = browserRun(input, 3), server = createModel2Run(input, 3);
    expect(browser.view()).toEqual(server.view());
    for (let n = 0; n < 3; n++) { browser.advance(); server.advance(); expect(browser.view()).toEqual(server.view()); }
    expect(browser.evidence()).toEqual(server.evidence());
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
});
