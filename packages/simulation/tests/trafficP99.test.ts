import { expect, test } from "bun:test";
import { keyspaceDesign, prepareKeyspace } from "./keyspace.fixture";
import { createLiveModel2 } from "../src/model2/product/live";
import { createModel2Run } from "../src/model2/product/liveRun";
import { resolveWorkload } from "@infraforge/domain/workload";

test("p50/p95/p99 are empirical quantiles of the same interval's real completed callers, or null", () => {
  const d = keyspaceDesign(); d.workload.targetThroughput = 12000;
  d.workload.workloadDynamics = { version: 1, arrivalProcess: "poisson", applicationCpuCv: 1 };
  const f = prepareKeyspace(d, "empirical-p99"), live = createLiveModel2(f.compiled, d.resources.map(r => r.id));
  expect(live.project().latencyMs).toEqual({ p50: null, p95: null, p99: null });
  for (let second = 1; second <= 3; second++) {
    live.advanceSecond(); const view = live.project(); f.runtime.advanceTo(second * 1000000);
    const sample = f.runtime.evidence().results.filter(r => r.outcome === "completed" && r.at > (second - 1) * 1000000 && r.at <= second * 1000000).map(r => r.responseUs).sort((a,b) => a-b);
    for (const [name, q] of [["p50", 0.5], ["p95", 0.95], ["p99", 0.99]] as const) expect(view.latencyMs[name]).toBe(sample.length ? sample[Math.ceil(q * sample.length) - 1]! / 1000 : null);
    expect(view.latencyMs.p50!).toBeLessThanOrEqual(view.latencyMs.p95!); expect(view.latencyMs.p95!).toBeLessThanOrEqual(view.latencyMs.p99!);
  }
});

test("captured live views preserve old bytes while explicit dynamics expose measured p99", () => {
  const d = keyspaceDesign(), input = { resources: d.resources, connectionLines: d.connections, seed: "live-tail", workloadProfile: resolveWorkload(d.workload) };
  const old = createModel2Run(input, 2); old.advance(); expect(old.view().traffic.latencyMs).not.toHaveProperty("p99");
  const run = createModel2Run({ ...input, workloadProfile: { ...input.workloadProfile, workloadDynamics: { version: 1, arrivalProcess: "even", applicationCpuCv: 0 } } }, 2);
  expect(run.view().traffic.latencyMs.p99).toBeNull(); run.advance(); expect(run.view().traffic.latencyMs.p99).toBeGreaterThan(0);
  expect(run.evidence()).toEqual(old.evidence());
});
