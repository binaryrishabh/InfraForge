import { expect, test } from "bun:test";
import { functionDesign } from "./serverlessCanvas.fixture";
import { prepare } from "./asyncCanvas.fixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { withRunLength } from "../src/model2/product/runContract";
import { createProductModel2 } from "../src/model2/product/run";
function run(concurrency: number) {
  const d = functionDesign(concurrency), f = prepare(d), contract = withRunLength(f.contract, 1, "function-pressure");
  contract.interventions = [{ id: "sessions", atUs: 0, request: { interventionId: "session-capacity", revision: 1, target: { resourceId: "db" }, parameters: { sessions: 8, duration: 1 } } }];
  const c = compileProduct(d, contract); if (!c.ok) throw Error(JSON.stringify(c));
  const runtime = createProductModel2(c.value); runtime.advanceTo(999999); return { runtime, evidence: runtime.evidence() };
}
test("more concurrent function invocations exhaust the real database session limit", () => {
  const low = run(1), high = run(128);
  expect(low.evidence.asynchronous.functions![0]!.peakInstances).toBe(1);
  expect(high.evidence.asynchronous.functions![0]!.peakInstances).toBe(128);
  expect(low.runtime.inspectData.database("db")).toHaveProperty("sessionEvents.refused", 0);
  expect(high.evidence.asynchronous.functions![0]!.downstreamFailed).toBeGreaterThan(0);
  expect(high.runtime.inspectData.database("db")).toHaveProperty("sessions.limit", 8);
  expect(high.runtime.inspectData.database("db")!.sessionEvents!.refused).toBeGreaterThan(0);
  expect(run(128).evidence).toEqual(high.evidence);
});
test("functions refuse missing, duplicated and mismatched capture or materialized intent", () => {
  const d = functionDesign(); expect(currentAdapterProfiles(d.resources)).toContain("serverless/1");
  for (const adapterProfiles of [[], ["serverless/1", "serverless/1"]] as const) expect(contractFromDesign(d, { adapterProfiles })).toHaveProperty("refused");
  const f = prepare(d), config = f.contract.nodes.fn!.resources[0]!.config; if (config.kind !== "serverless") throw Error("function config");
  config.database = "$fn"; expect(compileProduct(d, f.contract).ok).toBe(false);
  const wrong = functionDesign(); wrong.resources[1]!.serverless = { version: 1 }; expect(contractFromDesign(wrong)).toHaveProperty("refused");
});
test("scheduled function invocations reuse warm instances until idle expiry", () => {
  const run = (idleExpiryMs: number) => {
    const d = functionDesign(1); d.workload.targetThroughput = 60;
    Object.assign(d.resources[0]!.serverless!, { durationMs: 10, idleExpiryMs });
    d.resources.push({ id: "timer", type: "Scheduler", x: 0, y: 200, scheduler: { version: 1, startMs: 100, periodMs: 250, maxTriggers: 4 } });
    d.connections.push({ id: "tick", sourceId: "timer", targetId: "fn", sourceType: "Scheduler", targetType: "Serverless Function", port: 443 });
    const f = prepare(d), c = compileProduct(d, withRunLength(f.contract, 1, "scheduled-function")); if (!c.ok) throw Error(JSON.stringify(c));
    const r = createProductModel2(c.value); r.advanceTo(999999); return r.evidence().asynchronous;
  };
  const warm = run(1000), cold = run(20);
  expect(warm.schedulers![0]!.completed).toBe(4); expect(cold.schedulers![0]!.completed).toBe(4);
  expect(warm.functions![0]).toMatchObject({ coldStarts: 1, warmStarts: 4, completed: 5 });
  expect(cold.functions![0]).toMatchObject({ coldStarts: 5, warmStarts: 0, expired: 5, completed: 5 });
});
