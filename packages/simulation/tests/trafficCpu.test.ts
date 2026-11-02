import { expect, test } from "bun:test";
import { sampleAppCpu, APP_CPU_DISTRIBUTION } from "../src/model2/compute/demand";
import { keyspaceDesign, prepareKeyspace, hash } from "./keyspace.fixture";
import { canvasFlow } from "./applicationFlow.fixture";
import { createProductModel2 } from "../src/model2/product/run";

test("CPU zero CV is exactly historical, while seeded resource/call/stage draws are independent", () => {
  expect(sampleAppCpu(0.25, undefined, "seed", "app", "call", "cpu")).toBe(0.25);
  expect(sampleAppCpu(0, { schema: "app-cpu-demand/1", cv: 0 }, "seed", "app", "call", "cpu")).toBe(0);
  const p = { schema: "app-cpu-demand/1" as const, cv: 0.5 };
  const draw = (seed = "s", resource = "app", call = "c", stage = "cpu") => sampleAppCpu(3000, p, seed, resource, call, stage);
  expect(draw()).toBe(draw()); expect(draw("other")).not.toBe(draw()); expect(draw("s", "other")).not.toBe(draw());
  expect(draw("s", "app", "other")).not.toBe(draw()); expect(draw("s", "app", "c", "next")).not.toBe(draw());
  const d = keyspaceDesign(), old = prepareKeyspace(d); old.runtime.advanceTo(3000000);
  d.workload.workloadDynamics = { version: 1, arrivalProcess: "even", applicationCpuCv: 0 };
  const fixed = prepareKeyspace(d); fixed.runtime.advanceTo(3000000);
  expect(hash(fixed.runtime.evidence())).toBe(hash(old.runtime.evidence()));
});

test("large deterministic CPU sample respects authored mean, CV and positive bounded whole microseconds", () => {
  for (const cv of [0.5, 1]) {
    let sum = 0, squares = 0, valid = true;
    const n = 100000, mean = 10000, ceiling = Math.round(mean * ((1 - cv) + cv * -Math.log(2 ** -20)));
    for (let i = 0; i < n; i++) {
      const v = sampleAppCpu(mean, { schema: "app-cpu-demand/1", cv }, "cpu-statistics", "app", String(i), "cpu");
      sum += v; squares += v * v; valid &&= Number.isSafeInteger(v) && v >= 1 && v <= ceiling;
    }
    expect(valid).toBe(true); expect(Math.abs(sum / n / mean - 1)).toBeLessThan(0.015);
    expect(Math.sqrt(squares / n - (sum / n) ** 2) / (sum / n)).toBeCloseTo(cv, 2);
  }
});

test("product compile adds the exact versioned distribution only to application demands and real flow steps", () => {
  const d = canvasFlow();
  d.resources[0]!.applicationFlow!.operations.read!.steps = [{ id: "first", kind: "compute" }, { id: "second", kind: "compute" }];
  d.workload.workloadDynamics = { version: 1, arrivalProcess: "even", applicationCpuCv: 1 };
  const f = prepareKeyspace(d, "flow-cpu"), profile = f.compiled.input.profiles.find(p => p.id === "canvas.read")!;
  expect(profile).toMatchObject({ cpuDistribution: { schema: "app-cpu-demand/1", cv: 1 } });
  expect(JSON.stringify(f.contract)).toContain(APP_CPU_DISTRIBUTION);
  const starts: Array<{ stage: string; demand: number }> = [];
  const runtime = createProductModel2(f.compiled, undefined, e => {
    if (e.kind === "app-cpu-demand" && e.resource === "app") starts.push({ stage: String(e.detail.stage), demand: Number(e.detail.demandCoreUs) });
  });
  runtime.advanceTo(1000000);
  expect(starts.map(s => s.stage)).toEqual(["first", "second"]);
  expect(starts[0]!.demand).not.toBe(starts[1]!.demand);
  expect(runtime.evidence().resources.find(r => r.id === "app")!.consumedCoreUs).toBe(starts.reduce((n, s) => n + s.demand, 0));
  expect(runtime.evidence().counts.completed).toBe(1);
});

test("variable app work widens real completion spread and leaves database and system CPU untouched", () => {
  const results = [0, 1].map(cv => {
    const d = keyspaceDesign(); d.workload.targetThroughput = 6000;
    d.workload.workloadDynamics = { version: 1, arrivalProcess: "even", applicationCpuCv: cv };
    const f = prepareKeyspace(d, "cpu-spread"); f.runtime.advanceTo(5000000);
    for (const p of f.compiled.input.profiles) if (!p.id.startsWith("canvas.")) expect(p).not.toHaveProperty("cpuDistribution");
    return f.runtime.evidence().results.filter(r => r.outcome === "completed").map(r => r.responseUs).sort((a,b) => a-b);
  });
  const spread = (r: number[]) => r[Math.ceil(r.length * 0.99) - 1]! - r[Math.ceil(r.length * 0.5) - 1]!;
  expect(spread(results[1]!)).toBeGreaterThan(spread(results[0]!));
});
