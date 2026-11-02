import { expect, test } from "bun:test";
import { compileProduct, contractFromDesign, createProductModel2, currentAdapterProfiles } from "../src/internalProduct";
import { withRunLength } from "../src/model2/product/runContract";
import { latencyComposition, type LatencySample } from "../src/model2/workload/latencyComposition";
import { latencyDesign } from "./latency.fixture";
import { quantities } from "./workloadFixture";
import type { CausalEvent } from "../src/model2/workload/causal";
import { classifyObjective } from "../src/model2/workload/objective";
import type { CallerOutcome } from "../src/model2/workload/contracts";

test("superseded service and dependency intervals cannot steal winning-attempt latency", () => {
  const samples: LatencySample[] = [], accounting = latencyComposition(1, s => samples.push(s));
  const work = { rootId: "root", callId: '["root","attempt",0,"entry"]', attempt: 0, operation: "read", offeredAt: 0 };
  const next = { ...work, callId: '["root","attempt",1,"entry"]', attempt: 1 };
  const child = { ...work, callId: '["root","attempt",0,"entry","dependency","db"]', parentCallId: work.callId };
  const emit = (kind: string, atUs: number, current = work, detail: CausalEvent["detail"] = {}) => accounting.observe({ kind, atUs, resource: "app", work: current, detail });
  emit("caller-offered", 0); emit("client-attempt-issued", 0); emit("app-admitted", 0); emit("app-start", 0);
  emit("app-dependency", 500, child);
  emit("client-attempt-terminal", 1000, work, { outcome: "rejected", timedOut: true });
  emit("client-retry-scheduled", 1000); emit("client-attempt-issued", 2000, next); emit("app-admitted", 2000, next); emit("app-start", 2000, next);
  emit("app-terminal", 4000); emit("app-terminal", 5000, next); emit("client-attempt-terminal", 5000, next, { outcome: "completed" });
  emit("caller-terminal", 5000, next, { outcome: "completed", responseUs: 5000 });
  expect(samples[0]).toMatchObject({ categoriesUs: { failedAttempt: 1000, clientRetryDelay: 1000, applicationService: 3000 }, unattributedUs: 0 });
  expect(samples[0]!.categoriesUs.dependency ?? 0).toBe(0);
});

function measure(timeout: boolean) {
  const design = latencyDesign(true);
  design.workload.targetThroughput = 6000;
  design.workload.clientRetry = { version: 1, maxAttempts: 2, backoffMs: 1, ...(timeout ? { attemptTimeoutMs: 5 } : {}) };
  design.workload.workloadDynamics = { version: 1, arrivalProcess: "poisson", applicationCpuCv: 0.5 };
  design.workload.workloadObjective = { version: 1, maxResponseMs: 50, targetSuccessPercent: 95 };
  design.resources.find(r => r.id === "app")!.vmExecution!.queuedRequests = 64;
  const b = contractFromDesign(design, { adapterProfiles: [...currentAdapterProfiles(design.resources, design.workload), "traffic-evidence/2"] });
  if ("refused" in b) throw Error(JSON.stringify(b));
  const contract = withRunLength(b.contract, 2, "timeout-consequences");
  for (const op of contract.application!.operations) op.onCallerStop = "detach";
  const { q, ledger } = quantities();
  contract.arrival.changes = [{ at: q("stop", 1_000_000, "us"), fraction: q("zero", 0, "ratio") }]; contract.ledger.push(...ledger);
  const c = compileProduct(design, contract); if (!c.ok) throw Error(JSON.stringify(c));
  const samples: LatencySample[] = [], events: CausalEvent[] = [];
  const accounting = latencyComposition(c.value.input.limits.maxRequests, s => samples.push(s));
  const run = createProductModel2(c.value, undefined, e => { events.push(e); accounting.observe(e); }); run.advanceTo(2_000_000);
  return { evidence: run.evidence(), events, samples, accounting };
}

test("timeouts multiply real LB/app/database load while conserving latency and classifying each original once", () => {
  const a = measure(false), c = measure(true), e = c.evidence;
  const originals = (f: typeof a) => f.events.filter(e => e.kind === "caller-offered").map(e => [e.atUs, e.work!.rootId]);
  expect(originals(c)).toEqual(originals(a));
  expect(e.clientRetry!.attemptsTimedOut).toBeGreaterThan(0);
  expect(e.clientRetry!.totalAttempts).toBeGreaterThan(e.counts.offered);
  expect(e.network.loadBalancers[0]!.received).toBe(e.clientRetry!.totalAttempts);
  expect(e.resources.find(r => r.id === "app")!.received).toBeGreaterThan(a.evidence.resources.find(r => r.id === "app")!.received);
  expect(e.resources.find(r => r.id === "db")!.received).toBeGreaterThan(a.evidence.resources.find(r => r.id === "db")!.received);
  expect(e.clientRetry!.extraLoadFactor).toBe(e.clientRetry!.totalAttempts / e.counts.offered);
  const timedOut = new Set(c.events.filter(e => e.kind === "client-attempt-terminal" && e.detail.timedOut).map(e => e.work!.rootId));
  const recovered = c.samples.filter(s => timedOut.has(s.rootId)); expect(recovered.length).toBeGreaterThan(0);
  for (const s of c.samples) {
    expect(Object.values(s.categoriesUs).reduce((n, t) => n + t, s.unattributedUs)).toBe(s.responseUs);
    expect(s.unattributedUs).toBeGreaterThanOrEqual(0);
  }
  expect(recovered.every(s => (s.categoriesUs.failedAttempt ?? 0) >= 5000 && (s.categoriesUs.clientRetryDelay ?? 0) === 1000)).toBe(true);
  const terminals = c.events.filter(e => e.kind === "caller-terminal");
  expect(new Set(terminals.map(e => e.work!.rootId)).size).toBe(terminals.length);
  const classified = { good: 0, late: 0, failed: 0, deadlineExceeded: 0, abandoned: 0 };
  for (const event of terminals) classified[classifyObjective(event.detail.outcome as CallerOutcome, event.detail.responseUs as number, 50000)]++;
  expect(e.objective).toMatchObject({ offered: e.counts.offered, ...classified });
  expect(e.objective!.offered).toBe(Object.values(classified).reduce((a, b) => a + b, e.objective!.pending + e.objective!.unresolvedPastThreshold));
  expect(c.accounting.liveRoots).toBe(e.counts.inFlight);
});
