import { expect, test } from "bun:test";
import { createLiveModel2 } from "../src/model2/product/live";
import { validateLedger } from "../src/reality/ledger";
import { RETRY_STUDY_POLICIES, retryStudyDesign, runRetryStudy, type StudyFailure, type StudyPolicy } from "./retryStudy";

const cache = new Map<string, ReturnType<typeof runRetryStudy>>();
function study(failure: StudyFailure, policy: StudyPolicy) {
  const key = `${failure}/${policy}`;
  if (!cache.has(key)) cache.set(key, runRetryStudy(failure, policy));
  return cache.get(key)!;
}
const policies = ["disabled", "aggressive", "bounded"] as const;

test("authored slow-query controls stay healthy at the same offered load without a session bottleneck", () => {
  for (const policy of policies) {
    const c = study("slow-control", policy), s = c.summary;
    expect([s.originalRequests, s.caller.completed, s.caller.rejected, s.retries, s.databaseAdmitted]).toEqual([500, 500, 0, 0, 536]);
    expect(s.databaseCpuUs).toBeCloseTo(10036000, 4);
    expect(s.sessionRefusals).toBe(0); expect(s.peakDbQueued).toBe(0);
    expect(c.compiled.input.dataInterventions).toEqual([]);
    expect(validateLedger(c.compiled.input.ledger)).toEqual([]);
    const live = createLiveModel2(c.compiled, retryStudyDesign(policy).resources.map((r) => r.id));
    for (let second = 1; second <= 12; second++) {
      live.advanceSecond(); const view = live.project();
      expect(view.overallHealth).toBe("healthy"); expect(view.metrics.db!.cpu!).toBeLessThan(55);
    }
  }
}, 15000);

test("sustained statement timeouts add admitted DB copies, CPU and drain delay without extra completions", () => {
  const results = policies.map((p) => study("slow-sustained", p).summary), [off, aggressive, bounded] = results;
  expect(results.map((s) => [s.originalRequests, s.attempts, s.retries, s.databaseAdmitted, s.caller.completed, s.caller.rejected])).toEqual([
    [500, 500, 0, 536, 99, 401], [500, 749, 249, 743, 99, 401], [500, 516, 16, 552, 99, 401],
  ]);
  expect(results.map((s) => s.databaseReasons["statement-timeout"])).toEqual([401, 586, 417]);
  expect(results.map((s) => s.peakDbQueued)).toEqual([48, 56, 52]);
  expect(results.map((s) => s.queueDrainAfterLoadFallUs)).toEqual([474000, 1525000, 514000]); // 1 ms observation grid.
  expect(results.map((s) => s.drainAfterLoadFallUs)).toEqual([993327, 2274717, 1472593]); // Exact foreground DB terminal times.
  expect(results.map((s) => s.repeatedDbAdmissions)).toEqual([0, 207, 16]);
  expect(aggressive!.databaseCpuUs).toBeCloseTo(2634817.6993387276, 4);
  expect(off!.databaseCpuUs).toBeCloseTo(2506678.6654820307, 4);
  expect(bounded!.databaseCpuUs).toBeCloseTo(2554605.270659875, 4);
  expect(aggressive!.databaseCpuUs).toBeGreaterThan(bounded!.databaseCpuUs);
  expect(bounded!.databaseCpuUs).toBeGreaterThan(off!.databaseCpuUs);
  for (const s of results) {
    expect(s.sessionRefusals).toBe(0); expect(s.peakSessions).toBeLessThan(s.sessions.limit);
    expect(s.peakOrphans).toBe(0); expect(s.lateDbCommits).toBe(0);
    expect(s.maxConcurrentDbCopies).toBe(1); expect(s.overlappingDbAdmissions).toBe(0);
    expect(s.databaseLive).toBe(0); expect(s.poolPending).toBe(0); expect(s.caller.inFlight).toBe(0);
  }
}, 15000);

test("the identical bounded policy rescues a short slow period with only four extra completed statements", () => {
  const results = policies.map((p) => study("slow-transient", p).summary), off = results[0]!, bounded = results[2]!;
  expect(results.map((s) => [s.attempts, s.retries, s.databaseAdmitted, s.caller.completed, s.caller.rejected])).toEqual([
    [500, 0, 536, 449, 51], [551, 51, 587, 500, 0], [504, 4, 540, 453, 47],
  ]);
  expect(bounded!.databaseCpuUs - off!.databaseCpuUs).toBeCloseTo(80000, 4);
  expect(bounded!.databaseAdmitted - off!.databaseAdmitted).toBe(bounded!.caller.completed - off!.caller.completed);
  expect(bounded!.databaseCommitted - off!.databaseCommitted).toBe(4);
  expect(bounded!.drainAfterLoadFallUs).toBe(off!.drainAfterLoadFallUs);
  expect(bounded!.queueDrainAfterLoadFallUs).toBe(0);
  expect(bounded!.remoteAfterStop).toBe(0); expect(bounded!.responseTimeouts).toBe(0);
  expect(study("slow-sustained", "bounded").summary.repeatedDbAdmissions).toBe(16);
}, 15000);

test("backoff reservations plus active retries obey the canvas budget and retain authored slow-fault provenance", () => {
  for (const policy of ["aggressive", "bounded"] as const) {
    const c = study("slow-sustained", policy), s = c.summary;
    expect(s.peakBudget).toBe(RETRY_STUDY_POLICIES[policy].maxConcurrentRetries!);
    expect(s.suppressed!.budget).toBe(policy === "aggressive" ? 251 : 385);
    expect(s.suppressed!.deadline).toBe(0); // Outer 4 s response timeout can bind before the 5 s caller deadline.
    expect(s.lateRetrySchedules).toBe(0); expect(s.lateRetryLaunches).toBe(0); expect(s.retriesWaiting).toBe(0);
    expect(validateLedger(c.compiled.input.ledger)).toEqual([]);
    expect(c.compiled.semantic.numericOrigins.some((r) => r.path.includes("dataInterventions") && r.origin === "user-authored" && r.sources.includes("study.slow.cores"))).toBe(true);
  }
});

test("remote-after-transport-stop counts delayed terminal callbacks, not extra committed queries", () => {
  const s = study("slow-sustained", "aggressive").summary;
  expect([s.responseTimeouts, s.callerResponseTimeouts, s.lbResponseTimeouts, s.poolResponseTimeouts]).toEqual([64, 64, 0, 0]);
  expect([s.remoteAfterStop, s.dbRemoteAfterStop, s.lbRemoteAfterStop]).toEqual([174, 34, 76]);
  expect(s.databaseCancelled).toBe(34); expect(s.lateDbCommits).toBe(0);
});

test("long DB deadlines expose the upstream response-timeout and cancellation blocker to overlapping retry copies", () => {
  const reference = study("slow-response", "disabled");
  for (const policy of policies) {
    const r = study("slow-response", policy), s = r.summary;
    expect([s.originalRequests, s.attempts, s.retries, s.databaseAdmitted, s.caller.completed, s.caller.rejected]).toEqual([100, 100, 0, 136, 23, 77]);
    expect(s.databaseReasons).toEqual({ cancelled: 89 });
    expect([s.responseTimeouts, s.callerResponseTimeouts, s.lbResponseTimeouts]).toEqual([77, 77, 0]);
    expect([s.remoteAfterStop, s.dbRemoteAfterStop, s.lbRemoteAfterStop]).toEqual([255, 89, 89]);
    expect(s.databaseCpuUs).toBeCloseTo(1214970.637557841, 4);
    expect(s.queueDrainAfterLoadFallUs).toBe(1000000); expect(s.drainAfterLoadFallUs).toBe(3913034);
    expect(s.maxConcurrentDbCopies).toBe(1); expect(s.overlappingDbAdmissions).toBe(0); expect(s.lateDbCommits).toBe(0);
    expect(r.evidence.data.databases).toEqual(reference.evidence.data.databases);
    expect(r.evidence.network.paths).toEqual(reference.evidence.network.paths);
    expect(r.chain.some((e) => e.kind === "transport-terminal" && e.detail.detail === "response-timeout")).toBe(true);
    expect(r.chain.some((e) => e.kind === "retry-scheduled")).toBe(false);
  }
  const control = study("slow-response-control", "bounded");
  expect([control.summary.caller.completed, control.summary.caller.rejected, control.summary.retries]).toEqual([100, 0, 0]);
  const live = createLiveModel2(control.compiled, retryStudyDesign("bounded").resources.map((r) => r.id));
  for (let second = 1; second <= 12; second++) {
    live.advanceSecond(); const view = live.project();
    expect(view.overallHealth).toBe("healthy"); expect(view.metrics.db!.cpu!).toBeLessThan(15);
  }
}, 15000);

test("authored CPU slowdown replays complete evidence, including queue-drain sampling, exactly", () => {
  const original = study("slow-sustained", "bounded"), replay = runRetryStudy("slow-sustained", "bounded");
  expect(replay.evidence).toEqual(original.evidence); expect(replay.summary).toEqual(original.summary);
  expect(replay.chain).toEqual(original.chain);
});
