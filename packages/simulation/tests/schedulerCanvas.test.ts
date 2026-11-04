import { expect, test } from "bun:test";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { currentAdapterProfiles, contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { withRunLength } from "../src/model2/product/runContract";
import { createProductModel2 } from "../src/model2/product/run";
import { prepare } from "./asyncCanvas.fixture";
import { withTimeline } from "../src/model2/product/timeline";
export function schedulerDesign(): SavedProductDesign {
  return { schema: "infraforge-saved-design/1", resources: [{ id: "app", type: "Virtual Machine", x: 0, y: 0 }, { id: "timer", type: "Scheduler", x: 0, y: 0, scheduler: { version: 1, periodMs: 10, maxTriggers: 100 } }], connections: [{ id: "tick", sourceId: "timer", targetId: "app", sourceType: "Scheduler", targetType: "Virtual Machine", port: 80 }], workload: { targetThroughput: 60, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light" } };
}
test("saved scheduler invokes its connected app with captured intent and real transport", () => {
  const d = schedulerDesign(), f = prepare(d), c = compileProduct(d, withRunLength(f.contract, 2, "scheduler-proof"));
  if (!c.ok) throw Error(JSON.stringify(c));
  const runtime = createProductModel2(c.value); runtime.advanceTo(2_000_000);
  expect(runtime.evidence().asynchronous.schedulers![0]).toMatchObject({ due: 100, completed: 100, failed: 0, fired: 100 });
  expect(runtime.inspect("app")).toHaveProperty("completed", 102);
});
test("scheduler requires exact captured profile, saved policy and single fixed downstream", () => {
  const d = schedulerDesign(); expect(currentAdapterProfiles(d.resources)).toContain("scheduler/1");
  for (const adapterProfiles of [[], ["scheduler/1", "scheduler/1"]] as const) expect(contractFromDesign(d, { adapterProfiles })).toHaveProperty("refused");
  const f = prepare(d), r = f.contract.nodes.timer!.resources[0]!.config;
  if (r.kind !== "scheduler") throw Error("missing timer");
  r.overlap = "allow"; expect(compileProduct(d, f.contract).ok).toBe(false);
  d.resources[1]!.scheduler!.periodMs = 100; expect(compileProduct(d, f.contract).ok).toBe(false);
  d.connections = []; expect(contractFromDesign(d)).toHaveProperty("refused");
});
test("a downstream outage produces bounded retry attempts and missed invocations on canvas", () => {
  const d = schedulerDesign(); d.resources[0]!.listenerSettings = { version: 1, ports: [] };
  const f = prepare(d), c = compileProduct(d, withRunLength(f.contract, 2, "scheduler-proof")); if (!c.ok) throw Error(JSON.stringify(c));
  const runtime = createProductModel2(c.value); runtime.advanceTo(2_000_000);
  const e = runtime.evidence().asynchronous.schedulers![0]!;
  expect(e.failed).toBeGreaterThan(0); expect(e.retried).toBe(e.failed * 2); expect(e.missed).toBe(100); expect(e.active).toBe(0);
});
test("overlap and period change downstream application work in controlled canvas runs", () => {
  const run = (overlap: "skip" | "allow" | "queue", periodMs = 1) => {
    const d = schedulerDesign(); Object.assign(d.resources[1]!.scheduler!, { overlap, periodMs, queueCapacity: 4 });
    const f = prepare(d), c = compileProduct(d, withRunLength(f.contract, 2, "scheduler-load")); if (!c.ok) throw Error(JSON.stringify(c));
    const r = createProductModel2(c.value); r.advanceTo(2_000_000); return { timer: r.evidence().asynchronous.schedulers![0]!, app: r.inspect("app") };
  };
  const skip = run("skip"), allow = run("allow"), queue = run("queue"), slow = run("skip", 20);
  expect(allow.timer.completed).toBeGreaterThan(skip.timer.completed);
  expect(queue.timer.completed).toBeGreaterThan(skip.timer.completed);
  expect(slow.timer.completed).toBe(100);
  expect(allow.app).toHaveProperty("completed", allow.timer.completed + 2);
  expect(run("allow")).toEqual(allow);
});
test("an ambiguous response repeats real database effects; scheduler identity is not a deduplication boundary", () => {
  const d = schedulerDesign();
  d.resources[1]!.scheduler = { version: 1, startMs: 100, periodMs: 0, maxAttempts: 3, retryDelayMs: 100, timeoutMs: 20 };
  d.resources.push({ id: "db", type: "Database", x: 300, y: 0 });
  d.connections.push({ id: "query", sourceId: "app", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432 });
  const f = prepare(d), contract = withRunLength(f.contract, 1, "scheduler-duplicate");
  const initial = compileProduct(d, contract); if (!initial.ok) throw Error(JSON.stringify(initial));
  const response = initial.value.input.paths.find(p => p.source === "timer" && p.target === "app")!.response;
  const delayed = withTimeline(contract, [{ id: "delayed", atUs: 0, kind: "network-delay", links: response, durationUs: 1000000, delayUs: 50000 }]);
  const c = compileProduct(d, delayed); if (!c.ok) throw Error(JSON.stringify(c));
  const r = createProductModel2(c.value); r.advanceTo(1_000_000);
  expect(r.evidence().asynchronous.schedulers![0]).toMatchObject({ due: 1, fired: 3, retried: 2, completed: 0, failed: 1, missed: 1 });
  expect(r.inspectData.database("db")?.logicalWrites).toBe(3);
});
