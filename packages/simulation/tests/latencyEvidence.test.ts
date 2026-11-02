import { expect, test } from "bun:test";
import { latencyEvidence } from "../src/model2/product/latencyEvidence";
import type { CausalEvent } from "../src/model2/workload/causal";

function terminal(evidence: ReturnType<typeof latencyEvidence>, id: number, responseUs: number, atUs = 1000000, outcome = "completed") {
  const work = { rootId: `root-${id}`, callId: `["root-${id}"]`, attempt: 0, operation: "read", offeredAt: atUs - responseUs };
  const send = (kind: string, time: number, detail: CausalEvent["detail"] = {}) => evidence.observe({ kind, atUs: time, resource: "app", work, detail });
  send("caller-offered", work.offeredAt); send("app-admitted", work.offeredAt); send("app-start", work.offeredAt + responseUs / 2);
  send("app-terminal", atUs); send("caller-terminal", atUs, { outcome, responseUs });
}
test("nearest-rank tail uses the exact completed sample, includes ties and is Unknown below 100", () => {
  const e = latencyEvidence(1000);
  for (let i = 0; i < 99; i++) terminal(e, i, 1000);
  expect(e.measure(1000000).latency.slowestOnePercent).toBeNull();
  terminal(e, 99, 10000);
  const measured = e.measure(1000000);
  expect(measured.latency.completedCount).toBe(100);
  // With 99 equal lower samples, nearest-rank p99 includes all tied samples.
  expect(measured.latencyMs.p99).toBe(1);
  expect(measured.latency.slowestOnePercent!.sampleCount).toBe(100);
  expect(measured.latency.typical!.totalMs).toBe(1.09);
  expect(measured.latency.typical!.categories.applicationQueue).toEqual({ meanMs: 0.545, share: 0.5 });
  expect(e.measure(1000000)).toEqual(measured);
  expect(e.measure(2000000).latency).toMatchObject({ completedCount: 0, typical: null, slowestOnePercent: null });
});
test("over-cap windows are Unknown without sampling, failures and stops are counts only", () => {
  const e = latencyEvidence(10, 2);
  terminal(e, 0, 1000); terminal(e, 1, 2000); terminal(e, 2, 3000);
  terminal(e, 3, 1000, 1000000, "rejected"); terminal(e, 4, 1000, 1000000, "abandoned");
  const m = e.measure(1000000);
  expect(m.latency).toMatchObject({ status: "sample-cap-exceeded", completedCount: 3, failedCount: 1, cancelledCount: 1, inFlightCount: 0, sampleCap: 2, typical: null, slowestOnePercent: null });
  expect(m.latencyMs).toEqual({ p50: null, p95: null, p99: null });
  terminal(e, 5, 1000, 2000000);
  expect(e.measure(2000000).latency).toMatchObject({ status: "complete", completedCount: 1, failedCount: 0, cancelledCount: 0 });
});
