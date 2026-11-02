import { expect, test } from "bun:test";
import type { CallerOutcome } from "../src/model2/workload/contracts";
import { classifyObjective } from "../src/model2/workload/objective";
import { compileProduct, contractFromDesign, createProductModel2, currentAdapterProfiles } from "../src/internalProduct";
import { withRunLength } from "../src/model2/product/runContract";
import { latencyDesign } from "./latency.fixture";
import { quantities } from "./workloadFixture";
import { objectiveEvidence } from "../src/model2/workload/objectiveEvidence";

test("terminal classification includes the exact response boundary and caller stop reasons", () => {
  expect(classifyObjective("completed", 250000, 250000)).toBe("good");
  expect(classifyObjective("completed", 250001, 250000)).toBe("late");
  for (const [outcome, bucket] of [["rejected", "failed"], ["deadline-exceeded", "deadlineExceeded"], ["abandoned", "abandoned"]] as const)
    expect(classifyObjective(outcome, 1, 250000)).toBe(bucket);
});

test("unresolved roots at the threshold remain pending; one microsecond older is provably bad", () => {
  const counter = objectiveEvidence({ version: 1, maxResponseMs: 1, targetSuccessPercent: 90 }, 2000);
  const live = [{ work: { offeredAt: 0 } }, { work: { offeredAt: 1 } }];
  expect(counter.measure(2, 1000, live)).toMatchObject({ pending: 2, unresolvedPastThreshold: 0 });
  expect(counter.measure(2, 1001, live)).toMatchObject({ pending: 1, unresolvedPastThreshold: 1 });
  counter.finish("completed", 1000);
  expect(counter.measure(2, 1001, live.slice(1))).toMatchObject({ good: 1, pending: 1, unresolvedPastThreshold: 0 });
});

const modes = ["healthy", "late", "lb-retry", "client-retry", "limiter", "queue-overflow", "queue-wait", "deadline", "abandon"] as const;
function compiled(mode: typeof modes[number], objective = true) {
  const d = latencyDesign(mode === "client-retry", mode === "limiter");
  if (mode === "queue-wait") d.resources.find(r => r.id === "app")!.vmExecution!.queuedRequests = 256;
  if (objective) d.workload.workloadObjective = { version: 1, maxResponseMs: mode === "late" ? 1 : 50, targetSuccessPercent: 95 };
  if (["healthy", "late", "deadline", "abandon"].includes(mode)) d.workload.targetThroughput = 6000;
  if (mode === "lb-retry") d.resources[0]!.retry = { enabled: true, maxAttempts: 2, backoffMs: 1, jitterRatio: 0, maxConcurrentRetries: 32, retryOn: ["backendFailure"] };
  const b = contractFromDesign(d, { adapterProfiles: [...currentAdapterProfiles(d.resources, d.workload), "traffic-evidence/2"] });
  if ("refused" in b) throw Error(JSON.stringify(b));
  const contract = withRunLength(b.contract, 2, "objective-outcomes");
  const { q, ledger } = quantities();
  if (mode === "deadline" || mode === "abandon") for (const op of contract.application!.operations) {
    if (mode === "deadline") op.callerTimeout = q(`${op.id}.objective-deadline`, 1000, "us");
    else op.abandonAfter = q(`${op.id}.objective-abandon`, 1000, "us");
  }
  contract.ledger.push(...ledger);
  // The accounting must not depend on the retained result prefix.
  contract.limits.maxRawResults = 0;
  const c = compileProduct(d, contract); if (!c.ok) throw Error(JSON.stringify(c));
  return c.value;
}

for (const mode of modes) test(`original-root conservation and unchanged simulation on a real compiled ${mode} run`, () => {
  const c = compiled(mode), run = createProductModel2(c), historical = createProductModel2(compiled(mode, false));
  const terminals = { good: 0, late: 0, failed: 0, deadlineExceeded: 0, abandoned: 0 };
  const observed = createProductModel2(c, undefined, e => {
    if (e.kind === "caller-terminal") terminals[classifyObjective(e.detail.outcome as CallerOutcome, e.detail.responseUs as number, c.input.workloadObjective!.maxResponseMs * 1000)]++;
  });
  for (let now = 0; now <= 2000000; now += 100000) {
    run.advanceTo(now); observed.advanceTo(now); historical.advanceTo(now);
    const e = run.evidence(), o = e.objective!;
    expect(o.offered).toBe(e.counts.offered);
    expect(o.offered).toBe(o.good + o.late + o.failed + o.deadlineExceeded + o.abandoned + o.unresolvedPastThreshold + o.pending);
    expect(o.good + o.late).toBe(e.counts.completed);
    expect(o).toMatchObject({ ...terminals, failed: e.counts.rejected, deadlineExceeded: e.counts.deadlineExceeded, abandoned: e.counts.abandoned });
    expect(o.unresolvedPastThreshold + o.pending).toBe(e.counts.inFlight);
    const { objective: _objective, ...withoutObjective } = structuredClone(e);
    withoutObjective.product.semantic.numericOrigins = withoutObjective.product.semantic.numericOrigins.filter(row => !row.path.startsWith("input.workloadObjective."));
    expect(JSON.stringify(withoutObjective)).toBe(JSON.stringify(historical.evidence()));
  }
  const e = run.evidence();
  expect(e.counts.offered).toBeGreaterThan(0);
  if (mode === "healthy") expect(e.objective!.good).toBeGreaterThan(0);
  if (mode === "late") expect(e.objective!.late).toBeGreaterThan(0);
  if (["lb-retry", "client-retry", "limiter", "queue-overflow"].includes(mode)) expect(e.objective!.failed).toBeGreaterThan(0);
  if (mode === "lb-retry") expect(e.network.loadBalancers[0]!.attempts).toBeGreaterThan(e.counts.offered);
  if (mode === "client-retry") expect(e.clientRetry!.totalAttempts).toBeGreaterThan(e.counts.offered);
  if (mode === "limiter") expect(e.network.loadBalancers[0]!.rateLimit!.rejected).toBeGreaterThan(0);
  if (mode === "queue-overflow") expect(e.resources.find(r => r.id === "app")!.rejected).toBeGreaterThan(0);
  if (mode === "queue-wait") expect(e.objective!.unresolvedPastThreshold).toBeGreaterThan(0);
  if (mode === "deadline") expect(e.objective!.deadlineExceeded).toBeGreaterThan(0);
  if (mode === "abandon") expect(e.objective!.abandoned).toBeGreaterThan(0);
  const oneShot = createProductModel2(c); oneShot.advanceTo(2000000);
  expect(JSON.stringify(oneShot.evidence())).toBe(JSON.stringify(e));
  expect(JSON.stringify(observed.evidence())).toBe(JSON.stringify(e));
});
