import { expect, test } from "bun:test";
import { DEFAULT_RETRY_SETTINGS } from "@infraforge/domain/resource";
import { latencyDesign } from "./latency.fixture";
import { compileProduct, contractFromDesign, createProductModel2, currentAdapterProfiles } from "../src/internalProduct";
import { withRunLength } from "../src/model2/product/runContract";
import { latencyComposition, type LatencySample } from "../src/model2/workload/latencyComposition";
import type { CausalEvent } from "../src/model2/workload/causal";

function measure(mode: string, stepped = false) {
  const design = latencyDesign(mode === "client-retry", mode === "limiter");
  design.workload.workloadDynamics = { version: 1, arrivalProcess: "poisson", applicationCpuCv: 0.5 };
  design.resources.find(r => r.id === "app")!.vmExecution!.queuedRequests = mode === "queue" ? 256 : 0;
  if (mode === "lb-retry") design.resources[0]!.retry = { ...DEFAULT_RETRY_SETTINGS, jitterRatio: 0, maxConcurrentRetries: 64, retryOn: ["backendFailure"] };
  if (mode === "direct") { design.resources = design.resources.filter(r => r.id !== "lb"); design.connections = design.connections.filter(e => e.sourceId !== "lb"); }
  const b = contractFromDesign(design, { adapterProfiles: [...currentAdapterProfiles(design.resources, design.workload), "traffic-evidence/2"] });
  if ("refused" in b) throw Error(JSON.stringify(b));
  const c = compileProduct(design, withRunLength(b.contract, 3, "latency-conservation")); if (!c.ok) throw Error(JSON.stringify(c));
  const samples: LatencySample[] = [], events: CausalEvent[] = [];
  const accounting = latencyComposition(c.value.input.limits.maxLiveCalls!, s => samples.push(s));
  const run = createProductModel2(c.value, undefined, e => { accounting.observe(e); events.push(e); });
  if (stepped) for (let at = 10000; at <= 3000000; at += 10000) run.advanceTo(at); else run.advanceTo(3000000);
  return { samples, events, accounting, evidence: run.evidence() };
}

for (const mode of ["direct", "queue", "lb-retry", "client-retry", "limiter"]) test(`completed caller conservation on real compiled ${mode} runs`, () => {
  const a = measure(mode), b = measure(mode, true);
  expect(a.samples.length).toBe(a.evidence.counts.completed);
  expect(a.samples.length).toBeGreaterThan(0);
  expect(a.samples).toEqual(b.samples); expect(a.evidence).toEqual(b.evidence);
  for (const s of a.samples) {
    expect(Object.values(s.categoriesUs).every(n => n >= 0)).toBe(true);
    expect(Object.values(s.categoriesUs).reduce((n, t) => n + t, s.unattributedUs)).toBe(s.responseUs);
  }
  expect(a.accounting.liveRoots).toBe(a.evidence.counts.inFlight);
  expect(a.samples.some(s => (s.categoriesUs.applicationService ?? 0) > 0)).toBe(true);
  expect(a.samples.some(s => (s.categoriesUs.dependency ?? 0) > 0)).toBe(true);
  if (mode === "queue") expect(a.samples.some(s => (s.categoriesUs.applicationQueue ?? 0) > 0)).toBe(true);
  if (mode === "client-retry") expect(a.samples.some(s => (s.categoriesUs.clientRetryDelay ?? 0) > 0 && (s.categoriesUs.failedAttempt ?? 0) > 0)).toBe(true);
  if (mode === "lb-retry") { expect(a.events.some(e => e.kind === "retry-scheduled")).toBe(true); expect(a.samples.some(s => (s.categoriesUs.failedAttempt ?? 0) > 0)).toBe(true); }
  if (mode === "limiter") expect(a.events.some(e => e.kind === "lb-rate-limited")).toBe(true);
});

test("missing events and bounded root overflow stay unattributed; stopped callers are excluded", () => {
  const samples: LatencySample[] = [], a = latencyComposition(2, s => samples.push(s), 4);
  const work = { rootId: "root", callId: '["root"]', attempt: 0, operation: "read", offeredAt: 0 };
  const send = (kind: string, atUs: number, detail: CausalEvent["detail"] = {}) => a.observe({ kind, atUs, resource: "app", work, detail });
  send("caller-offered", 0); send("app-start", 5); send("caller-terminal", 20, { outcome: "completed", responseUs: 20 });
  expect(samples[0]).toMatchObject({ responseUs: 20, unattributedUs: 20 });
  send("caller-offered", 30); send("caller-terminal", 40, { outcome: "abandoned", responseUs: 10 });
  expect(samples).toHaveLength(1); expect(a.liveRoots).toBe(0);
  send("caller-offered", 50);
  for (let i = 0; i < 8; i++) { send("app-admitted", 50 + i); send("app-start", 50 + i); send("app-terminal", 51 + i); }
  send("caller-terminal", 100, { outcome: "completed", responseUs: 50 });
  expect(samples[1]).toMatchObject({ unattributedUs: 50, bounded: false });
  expect(a.liveRoots).toBe(0);
});

test("nested downstream transport is owned once and remote work after transport stop is clipped", () => {
  const samples: LatencySample[] = [], a = latencyComposition(1, s => samples.push(s));
  const parent = { rootId: "root", callId: '["root"]', attempt: 0, operation: "read", offeredAt: 0 };
  const child = { ...parent, callId: '["root","dependency","db"]', parentCallId: parent.callId };
  const emit = (kind: string, atUs: number, work = parent, detail: CausalEvent["detail"] = {}, resource = "app") => a.observe({ kind, atUs, resource, work, detail });
  emit("caller-offered", 0); emit("latency-path-start", 0); emit("latency-path-acquired", 10); emit("latency-path-delivered", 20);
  emit("app-admitted", 20); emit("app-start", 30); emit("app-dependency", 50, child);
  emit("latency-path-start", 50, child, {}, "db"); emit("latency-path-acquired", 60, child, {}, "db");
  emit("latency-path-delivered", 70, child, {}, "db"); emit("latency-path-remote-terminal", 80, child, {}, "db"); emit("latency-path-terminal", 90, child, {}, "db");
  emit("app-terminal", 90); emit("latency-path-remote-terminal", 90); emit("latency-path-terminal", 100);
  emit("caller-terminal", 100, parent, { outcome: "completed", responseUs: 100 });
  expect(samples[0]!.categoriesUs).toMatchObject({ connectionWait: 10, networkTransit: 20, applicationQueue: 10, applicationService: 20, dependency: 40 });
  expect(samples[0]!.unattributedUs).toBe(0);
  emit("caller-offered", 110); emit("latency-path-start", 110); emit("latency-path-acquired", 110); emit("latency-path-delivered", 110);
  emit("app-admitted", 110); emit("app-start", 110); emit("latency-path-terminal", 120); emit("app-terminal", 150);
  emit("caller-terminal", 160, parent, { outcome: "completed", responseUs: 50 });
  expect(samples[1]!.categoriesUs.applicationService).toBe(10); expect(samples[1]!.unattributedUs).toBe(40);
});
