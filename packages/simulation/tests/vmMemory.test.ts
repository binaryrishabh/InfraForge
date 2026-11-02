import { expect, test } from "bun:test";
import { prepareMemory, tightMemory, memoryState, recompileMemory } from "./vmMemory.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { requireKnown } from "../src/reality/quantity";
import { createProductModel2 } from "../src/model2/product/run";
import { clientRetryDecision } from "../src/model2/workload/clientRetry";
import { seedCause } from "../src/model2/workload/cause";
import { quantities } from "./workloadFixture";
import { prepareKeyspace } from "./keyspace.fixture";
import { vmDesign } from "./vmExecution.fixture";

const MiB = 1048576;
test("authored memory binds only the VM primary and every operation, with catalog GiB provenance", () => {
  const f = prepareMemory(false, tightMemory), app = f.compiled.input.resources.find(r => r.id === "app");
  if (app?.kind !== "compute") throw Error("Missing app");
  expect(app.memory.coverage).toBe("complete-model"); expect(app.memory.policy).toBe("reject-allocation");
  expect(requireKnown(app.memory.baseline!, "bytes")).toBe(1024 * MiB); expect(requireKnown(app.memory.limit!, "bytes")).toBe(2048 * MiB);
  for (const id of Object.values(app.profiles)) {
    const p = f.compiled.input.profiles.find(p => p.id === id)!;
    if (p.schema !== "infraforge-compute-demand/1") throw Error("Missing compute demand");
    expect(p.residentCoverage).toBe("complete-model"); expect(requireKnown(p.requestResidentBytes!, "bytes")).toBe(128 * MiB);
    expect(requireKnown(p.activeResidentBytes!, "bytes")).toBe(0);
  }
  expect(JSON.stringify(f.contract.ledger)).toContain("catalog label interpreted as GiB; only the authored baseline and per-request amounts are counted");
  for (const mutate of [() => { app.memory.policy = "observe"; }, () => { app.memory.baseline = app.memory.limit; }]) {
    const clone = structuredClone(f.contract), primary = clone.nodes.app!.resources.find(r => r.role === "main")!.config;
    if (primary.kind !== "compute") throw Error("Missing primary");
    mutate(); primary.memory = app.memory; expect(compileProduct(f.design, clone).ok).toBe(false);
  }
});
for (const lb of [false, true]) test(`queued requests hold memory and refusals reach caller through ${lb ? "LB" : "direct"} path`, () => {
  let refused = 0, callerRefused = 0;
  const f = prepareMemory(lb, tightMemory, e => {
    if (e.kind === "caller-terminal" && e.detail.rootReason === "memory-limit") callerRefused++;
    if (e.kind === "app-rejected" && e.resource === "app") {
      refused++; const s = memoryState(f.runtime), m = s.compute!.memory;
      expect(m.totalResidentBytes.kind).toBe("known");
      expect(m.knownSubtotalBytes + 128 * MiB).toBeGreaterThan(m.limitBytes!);
      expect(e.detail.rootReason).toBe("memory-limit");
    }
  });
  let queued = false;
  for (let at = 10000; at <= 1000000; at += 10000) {
    f.runtime.advanceTo(at); const s = memoryState(f.runtime), m = s.compute!.memory;
    queued ||= s.queued > 0;
    expect(m.ownership.requests).toBe(s.queued + s.serving + s.waiting);
    expect(m.knownSubtotalBytes).toBe((1024 + m.ownership.requests * 128) * MiB);
    expect(m.knownSubtotalBytes).toBeLessThanOrEqual(m.limitBytes!);
    expect(m.ownership.requests).toBeLessThanOrEqual(8);
  }
  expect(queued).toBe(true); expect(refused).toBeGreaterThan(0);
  expect(memoryState(f.runtime).compute!.allocationRejected).toBe(refused);
  const e = f.runtime.evidence(); expect(e.counts.rejected).toBeGreaterThan(0);
  expect(callerRefused).toBeGreaterThan(0);
});
test("activation refuses extra running allocation independently of queue admission", () => {
  let callerRefused = 0;
  const f = prepareMemory(false, { version: 1, baselineMiB: 2048, requestMiB: 0, activeMiB: 1 }, e => {
    if (e.kind === "caller-terminal" && e.detail.rootReason === "memory-limit") callerRefused++;
  });
  f.runtime.advanceTo(100000); const s = memoryState(f.runtime);
  expect(s.admitted).toBeGreaterThan(0); expect(s.rejected).toBe(0); expect(s.failed).toBe(s.admitted);
  expect(s.compute!.allocationRejected).toBe(s.admitted); expect(s.compute!.memory.ownership.requests).toBe(0);
  expect(callerRefused).toBeGreaterThan(0);
});
test("completion and caller deadline cancellation release holdings and later requests can fit", () => {
  const f = prepareMemory(false, tightMemory), compiled = recompileMemory(f);
  compiled.input.arrivals = [{ id: "waves", kind: "trace", trace: { schema: "infraforge-arrivals/1", unit: "us", durationUs: 1000000, provenance: "Deterministic memory recovery proof", rows: Array.from({ length: 20 }, (_, i) => ({ id: String(i), atUs: i < 19 ? i : 500000, operation: "read" })) } }];
  const runtime = createProductModel2(compiled); runtime.advanceTo(200000);
  const before = memoryState(runtime); expect(before.compute!.allocationRejected).toBeGreaterThan(0);
  expect(before.compute!.memory.ownership.requests).toBe(0);
  runtime.advanceTo(700000); expect(memoryState(runtime).completed).toBeGreaterThan(before.completed);
  expect(memoryState(runtime).compute!.allocationRejected).toBe(before.compute!.allocationRejected);
  const timed = structuredClone(compiled);
  // Short deadlines cancel queued and active holdings through the normal caller contract.
  const q = quantities();
  timed.input.operations = timed.input.operations.map(op => ({ ...op, callerTimeout: q.q(`memory-proof.${op.id}.timeout`, 1000, "us") }));
  timed.input.ledger.push(...q.ledger);
  const cancelled = createProductModel2(timed); cancelled.advanceTo(200000);
  expect(memoryState(cancelled).cancelled).toBeGreaterThan(0); expect(memoryState(cancelled).compute!.memory.ownership.requests).toBe(0);
});
test("one-shot equals stepped and memory-limit is ineligible for client retries", () => {
  const f = prepareMemory(true, tightMemory), stepped = f.make();
  f.runtime.advanceTo(3000000); for (let at = 17000; at < 3000000; at += 17000) stepped.advanceTo(at); stepped.advanceTo(3000000);
  expect(stepped.evidence()).toEqual(f.runtime.evidence());
  expect(clientRetryDecision({ version: 1, maxAttempts: 3, backoffMs: 10 }, 0, 100, 100000, 100000, seedCause("memory-limit", "app"))).toEqual({ reason: "ineligible" });
});
test("compiler refuses altered operation amounts and all replicas keep their own authored model", () => {
  const d = vmDesign("autoscaled"); d.resources.find(r => r.id === "app")!.vmMemory = { ...tightMemory, activeMiB: 16 };
  const f = prepareKeyspace(d), apps = f.compiled.input.resources.filter(r => r.kind === "compute" && r.id.startsWith("app#") && !r.id.includes("/"));
  expect(apps).toHaveLength(3);
  expect(apps.every(r => r.kind === "compute" && r.memory.coverage === "complete-model")).toBe(true);
  const demand = f.contract.application!.demands.find(p => p.id === "app.vmMemory.read");
  if (demand?.schema !== "infraforge-compute-demand/1" || demand.activeResidentBytes?.kind !== "known") throw Error("Missing authored demand");
  demand.activeResidentBytes.value++; expect(compileProduct(d, f.contract).ok).toBe(false);
});
test("upload producer helpers and database execution keep partial observation", () => {
  const d = vmDesign("async"); d.resources.find(r => r.id === "app")!.vmMemory = tightMemory;
  const f = prepareKeyspace(d), app = f.compiled.input.resources.find(r => r.id === "app");
  expect(app).toHaveProperty("memory.coverage", "complete-model");
  for (const r of f.compiled.input.resources) if ("execution" in r) expect(r.execution.memory.coverage).toBe("partial");
});
