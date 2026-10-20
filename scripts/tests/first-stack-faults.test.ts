import { expect, test } from "bun:test";
import { firstStackFaultFixture } from "../fixtures/first-stack-faults";
import { runFirstStackQualification, instantiatePreparedFirstStack } from "../../apps/backend/firstStack/execution";
import type { CausalEvent } from "../../packages/simulation/src/model2/workload/causal";

for (const shared of [false, true]) test(`app crash settles work and replaces generation; shared=${shared}`, async () => {
  const f = await firstStackFaultFixture({ shared }), events: CausalEvent[] = [];
  const prepared = f.prepare(), runtime = instantiatePreparedFirstStack(prepared, e => events.push(structuredClone(e)));
  runtime.advanceTo(5500);
  const cut = runtime.evidence();
  expect(cut.composition.lifecycle.find(r => r.id === "app-1")).toMatchObject({ generation: 1, state: "retired" });
  const crashed = cut.resources.find(r => r.id === "app-1")!;
  expect(crashed).toMatchObject({ queued: 0, serving: 0, waiting: 0 });
  expect(cut.network.loadBalancers[0]!.backends.find(b => b.id === "app-1")!.health).toBe(false);
  expect(cut.composition.memory.find(h => h.id === (shared ? "shared-apps" : "host-app-1"))!.reservedBytes).toBe(shared ? 100 : 0);
  runtime.advanceTo(8000);
  expect(runtime.evidence().composition.lifecycle.find(r => r.id === "app-1")).toMatchObject({ generation: 2, state: "ready" });
  expect(runtime.evidence().network.loadBalancers[0]!.backends.find(b => b.id === "app-1")!.health).toBe(false);
  runtime.advanceTo(runtime.horizon);
  const result = runtime.evidence(), lb = result.network.loadBalancers[0]!;
  expect(lb.backends.find(b => b.id === "app-1")!.health).toBe(true);
  expect(lb.attempts).toBeLessThanOrEqual(16); expect(lb.retries).toBeGreaterThan(0);
  expect(result.counts.offered).toBe(8); expect(result.counts.inFlight).toBe(0);
  expect(result.data.databases[0]!.transactions.live).toBe(0);
  expect(result.network.paths.every(p => p.live === 0)).toBe(true);
  expect(events.filter(e => e.kind === "process-crash")).toHaveLength(1);
  expect(events.filter(e => e.kind === "process-ready")).toHaveLength(1);
  expect(runFirstStackQualification(prepared).evidence).toEqual(result);
});

test("directed delay/partition are bounded, deterministic and locked", async () => {
  const f = await firstStackFaultFixture();
  f.sidecar.faults = [
    { schema: "first-stack-fault/1", id: "partition", kind: "directed-partition", target: f.sidecar.paths[0]!.requestLink, atUs: 5000, durationUs: 1500 },
    { schema: "first-stack-fault/1", id: "delay", kind: "directed-delay", target: f.sidecar.paths[0]!.responseLink, atUs: 5000, durationUs: 1500, delayUs: 1000 },
  ];
  const prepared = f.prepare(), result = runFirstStackQualification(prepared);
  expect(result.evidence.counts.offered).toBe(8);
  expect(result.evidence.network.loadBalancers[0]!.attempts).toBeLessThanOrEqual(16);
  f.sidecar.faults.reverse(); expect(f.prepare().compiledHash).toBe(prepared.compiledHash);
  prepared.sidecar.faults[0]!.atUs++;
  expect(() => runFirstStackQualification(prepared)).toThrow("Reviewed inputs changed");
});

test("ambiguous writes never retry; unsafe scope and overlapping intervals refuse", async () => {
  const f = await firstStackFaultFixture({ write: true });
  const e = runFirstStackQualification(f.prepare()).evidence;
  expect(e.network.loadBalancers[0]!.retries).toBe(0);
  f.sidecar.retry = { schema: "first-stack-read-retry/1", owner: "load-balancer", operations: ["read"], maxAttempts: 2, backoffUs: 100, maxConcurrentRetries: 4 };
  expect(() => f.prepare()).toThrow("Only explicit idempotent foreground reads");
  delete f.sidecar.retry;
  f.sidecar.faults.push({ ...f.sidecar.faults[0]!, id: "overlap" });
  expect(() => f.prepare()).toThrow("non-overlapping");
  f.sidecar.faults = [{ ...f.sidecar.faults[0]!, target: "db" }];
  expect(() => f.prepare()).toThrow("initially ready compute");
  const raw = JSON.parse(JSON.stringify(f.sidecar)); raw.faults[0].kind = "CpuSpike";
  const { reviewSidecar } = await import("../../apps/backend/firstStack/authoring");
  expect(reviewSidecar(f.layout, raw).ok).toBe(false);
  raw.faults[0].kind = "cache-flush"; expect(reviewSidecar(f.layout, raw).ok).toBe(false);
});

test("fault wins equal-time app dependency completion and repeated crashes advance generations", async () => {
  const f = await firstStackFaultFixture();
  f.sidecar.faults = [];
  const events: CausalEvent[] = [];
  runFirstStackQualification(f.prepare(), e => events.push(e));
  const terminal = events.find(e => e.kind === "app-terminal" && e.resource === "app-1" && e.work?.operation === "read")!;
  expect(terminal).toBeDefined();
  f.sidecar.faults = [{ schema: "first-stack-fault/1", id: "equal-time", kind: "app-process-crash", target: "app-1", atUs: terminal.atUs, downtimeUs: 1000, recoveryUs: 500 },
    { schema: "first-stack-fault/1", id: "second", kind: "app-process-crash", target: "app-1", atUs: 17000, downtimeUs: 1000, recoveryUs: 500 }];
  const faultEvents: CausalEvent[] = [], e = runFirstStackQualification(f.prepare(), event => faultEvents.push(event)).evidence;
  const settled = faultEvents.find(event => event.kind === "app-terminal" && event.work?.callId === terminal.work?.callId)!;
  expect(settled.atUs).toBe(terminal.atUs); expect(settled.detail.outcome).toBe("rejected");
  expect(e.composition.lifecycle.find(r => r.id === "app-1")).toMatchObject({ generation: 3, state: "ready" });
  expect(e.network.paths.every(p => p.pool.pending === 0 && p.live === 0)).toBe(true);
});

test("read retry allowlist excludes writes even on unambiguous failure and is at most two attempts", async () => {
  const f = await firstStackFaultFixture();
  f.sidecar.faults = [{ schema: "first-stack-fault/1", id: "response-loss", kind: "directed-partition", target: f.sidecar.paths[0]!.responseLink, atUs: 5000, durationUs: 14000 }];
  const events: CausalEvent[] = [];
  const e = runFirstStackQualification(f.prepare(), event => events.push(event)).evidence;
  expect(e.network.loadBalancers[0]!.attempts).toBeLessThanOrEqual(16);
  expect(e.network.loadBalancers[0]!.retries).toBeGreaterThan(0);
  const calls = events.filter(event => event.kind === "app-start" && event.work?.operation === "read");
  expect(calls.every(event => event.work!.attempt <= 2)).toBe(true);
  expect(e.data.databases[0]!.logicalWrites).toBe(0);
});

test("crash before equal-time generic DB commit aborts; a prior commit survives response loss", async () => {
  const f = await firstStackFaultFixture({ write: true }); f.sidecar.faults = [];
  const events: CausalEvent[] = []; runFirstStackQualification(f.prepare(), e => events.push(e));
  const commit = events.find(e => e.kind === "db-terminal" && e.work?.operation === "read" && JSON.parse(e.work.callId).includes("app-1"))!;
  expect(commit.detail.outcome).toBe("committed");
  const outcomes: string[] = [];
  for (const shift of [0, 1]) {
    f.sidecar.faults = [{ schema: "first-stack-fault/1", id: "commit-order", kind: "app-process-crash", target: "app-1", atUs: commit.atUs + shift, downtimeUs: 1000, recoveryUs: 500 }];
    const actual: CausalEvent[] = [], e = runFirstStackQualification(f.prepare(), event => actual.push(event)).evidence;
    outcomes.push(String(actual.find(event => event.kind === "db-terminal" && event.work?.callId === commit.work!.callId)!.detail.outcome));
    expect(e.network.loadBalancers[0]!.retries).toBe(0);
    expect(e.data.databases[0]!.transactions.live).toBe(0);
  }
  expect(outcomes).toEqual(["aborted", "committed"]);
});

test("process fault precedes an equal-time transport response deadline", async () => {
  const f = await firstStackFaultFixture();
  f.sidecar.faults = [{ schema: "first-stack-fault/1", id: "slow-response", kind: "directed-delay", target: f.sidecar.paths.find(p => p.target === "app-1")!.responseLink, atUs: 5000, durationUs: 14000, delayUs: 10000 }];
  const baseline: CausalEvent[] = []; runFirstStackQualification(f.prepare(), e => baseline.push(e));
  const deadline = baseline.find(e => e.kind === "attempt-terminal" && String(e.detail.id).includes("app-1") && e.detail.detail === "response-timeout")!;
  expect(deadline).toBeDefined();
  f.sidecar.faults.push({ schema: "first-stack-fault/1", id: "deadline-tie", kind: "app-process-crash", target: "app-1", atUs: deadline.atUs, downtimeUs: 1000, recoveryUs: 500 });
  const actual: CausalEvent[] = []; runFirstStackQualification(f.prepare(), e => actual.push(e));
  const terminal = actual.find(e => e.kind === "attempt-terminal" && e.detail.id === deadline.detail.id)!;
  expect(terminal.atUs).toBe(deadline.atUs); expect(terminal.detail.detail).toBe("reset");
});

test("retained fault proof pins current source, repeated outcomes and observer equality", async () => {
  const { faultProof } = await import("../reality/first-stack-fault-proof");
  expect(await faultProof()).toMatchObject({ cases: 5, observerEqual: true, repeatedBytesEqual: true });
});

test("cache V3 keeps faults and retries outside its reviewed composition", async () => {
  const { firstStackCacheFixture } = await import("../fixtures/first-stack-cache");
  const { sidecarV3Schema } = await import("../../apps/backend/firstStack/authoring");
  const { compileFirstStack } = await import("../../packages/simulation/src/firstStack/compiler");
  const f = await firstStackCacheFixture(), fault = await firstStackFaultFixture();
  for (const overlay of [{ faults: fault.sidecar.faults }, { retry: fault.sidecar.retry }]) {
    const candidate = { ...f.sidecar, ...overlay };
    expect(sidecarV3Schema.safeParse(candidate).success).toBe(false);
    expect(() => compileFirstStack(candidate as typeof f.sidecar, f.schedule, f.policy)).toThrow("separately reviewed composition revision");
  }
});
