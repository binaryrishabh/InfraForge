import { expect, test } from "bun:test";
import { createLiveModel2 } from "../src/model2/product/live";
import { RETRY_STUDY_POLICIES, retryStudyDesign, runRetryStudy, type StudyFailure, type StudyPolicy } from "./retryStudy";

const cases = new Map<string, ReturnType<typeof runRetryStudy>>();
function study(failure: StudyFailure, policy: StudyPolicy, reads = 1) {
  const key = `${failure}/${policy}/${reads}`;
  if (!cases.has(key)) cases.set(key, runRetryStudy(failure, policy, reads));
  return cases.get(key)!;
}

test("saved canvas overload amplifies real attempts and session refusals without inventing a throughput collapse", () => {
  const off = study("overload", "disabled").summary, aggressive = study("overload", "aggressive").summary, bounded = study("overload", "bounded").summary;
  expect([off, aggressive, bounded].map((s) => [s.originalRequests, s.attempts, s.retries, s.databaseCalls, s.databaseAdmitted, s.sessionRefusals, s.caller.completed, s.caller.rejected])).toEqual([
    [8200, 8200, 0, 8224, 4301, 3923, 4287, 3913],
    [8200, 16793, 8593, 16817, 4302, 12515, 4290, 3910],
    [8200, 8303, 103, 8327, 4304, 4023, 4291, 3909],
  ]);
  expect(aggressive.databaseCalls).toBeGreaterThan(bounded.databaseCalls);
  expect(bounded.databaseCalls).toBeGreaterThan(off.databaseCalls);
  expect(aggressive.sessionRefusals).toBeGreaterThan(3 * off.sessionRefusals);
  // The session gate sheds most extra work before admission; do not claim more committed DB work or a much longer outage.
  expect(aggressive.databaseAdmitted - off.databaseAdmitted).toBe(1);
  expect([off, aggressive, bounded].map((s) => s.drainAfterLoadFallUs)).toEqual([92091, 93330, 95330]);
  for (const s of [off, aggressive, bounded]) {
    expect(s.peakSessions).toBe(s.sessions.limit);
    expect(s.peakDbQueued).toBe(84);
    expect(s.databaseLive).toBe(0); expect(s.databaseQueued).toBe(0); expect(s.poolPending).toBe(0);
    expect(s.caller.inFlight).toBe(0); expect(s.sessions.idle).toBe(100);
    expect(s.poolWaitUs).toBe(10000);
    expect([s.poolAcquireTimeouts, s.poolResponseTimeouts, s.poolOverflow, s.peakOrphans]).toEqual([0, 0, 0, 0]);
  }
  expect(off.retriesWaiting).toBeNull(); // Disabled profile does not retain this field; never invent a measurement.
}, 30000);

test("the same bounded policy rescues a transient failure with one DB call per rescued request", () => {
  const off = study("transient", "disabled").summary, aggressive = study("transient", "aggressive").summary, bounded = study("transient", "bounded").summary;
  expect([off, aggressive, bounded].map((s) => [s.originalRequests, s.attempts, s.retries, s.databaseCalls, s.databaseAdmitted, s.sessionRefusals, s.caller.completed, s.caller.rejected])).toEqual([
    [1000, 1000, 0, 1004, 1004, 0, 980, 20],
    [1000, 1020, 20, 1022, 1022, 0, 998, 2],
    [1000, 1018, 18, 1022, 1022, 0, 998, 2],
  ]);
  const rescued = bounded.caller.completed - off.caller.completed;
  expect(rescued).toBe(18);
  expect(bounded.databaseCalls - off.databaseCalls).toBe(rescued);
  expect(study("transient", "bounded").samples.slice(2).map((s) => [s.dbQueued, s.dbServing, s.retriesWaiting])).toEqual(Array.from({ length: 6 }, () => [0, 0, 0]));
  expect(study("overload", "bounded").summary.sessionRefusals - study("overload", "disabled").summary.sessionRefusals).toBe(100);
}, 15000);

test("the no-fault transient control stays healthy with spare CPU and sessions", () => {
  const control = study("control", "bounded");
  expect(control.summary.caller.completed).toBe(1000); expect(control.summary.caller.rejected).toBe(0);
  expect(control.summary.retries).toBe(0); expect(control.summary.peakSessions).toBe(15);
  const live = createLiveModel2(control.compiled, retryStudyDesign("bounded").resources.map((r) => r.id));
  for (let s = 1; s <= 8; s++) {
    live.advanceSecond(); const view = live.project();
    expect(view.overallHealth).toBe("healthy");
    expect(view.metrics.db!.cpu).not.toBeNull(); expect(view.metrics.db!.cpu!).toBeLessThan(25);
  }
});

test("waiting and executing retries share the cap, and five-attempt policies expose budget/deadline suppression", () => {
  for (const policy of ["aggressive", "bounded", "deadline"] as const) {
    const s = study("overload", policy).summary;
    expect(s.peakBudget).toBe(RETRY_STUDY_POLICIES[policy].maxConcurrentRetries!);
    expect(s.suppressed!.budget).toBeGreaterThan(0);
    expect(s.retriesWaiting).toBe(0); expect(s.lateRetrySchedules).toBe(0); expect(s.lateRetryLaunches).toBe(0);
    expect(s.observedSuppressions).toBe(Object.values(s.suppressed!).reduce((sum, n) => sum + n, 0));
  }
  const deadline = study("overload", "deadline").summary;
  expect(deadline.suppressed).toMatchObject({ deadline: 46, budget: 3801 });
  expect(deadline.peakRetriesWaiting).toBe(64);
  expect(deadline.attempts).toBe(8264); expect(deadline.retries).toBe(64);
  expect(deadline.caller.deadlineExceeded).toBe(0); // Policy prevented a late retry; these are not caller timeout outcomes.
}, 15000);

test("a canvas request retains failure, scheduled jitter delay, different backend and success in causal evidence", () => {
  const { chain, summary } = study("transient", "bounded");
  const events = chain.filter((e) => ["caller-offered", "lb-received", "lb-selected", "attempt-terminal", "retry-scheduled", "caller-terminal"].includes(e.kind));
  expect(events.map((e) => [e.atUs, e.kind, e.detail.detail ?? e.detail.outcome ?? null])).toEqual([
    [1140000, "caller-offered", null], [1140109, "lb-received", null],
    [1140109, "lb-selected", "app0"], [1140109, "attempt-terminal", "backend-rejected"],
    [1140109, "retry-scheduled", "backend-rejected:117634us"],
    [1257743, "lb-selected", "app1"], [1262179, "attempt-terminal", "completed"], [1262288, "caller-terminal", "completed"],
  ]);
  expect(events[3]!.detail.id).toBe(events[4]!.detail.id);
  expect(events[2]!.detail.id).not.toBe(events[5]!.detail.id);
  expect(events[5]!.atUs - events[4]!.atUs).toBe(117634);
  expect(new Set(events.map((e) => e.work?.rootId ?? e.detail.root)).size).toBe(1);
  expect(summary.chainOmitted).toBe(0);
  expect(summary.traceOmitted).toBeGreaterThan(0); // Default raw trace is bounded; observer retention captured this later request.
});

test("ambiguous writes remain single-attempt in the overloaded saved canvas", () => {
  const { summary } = study("overload", "aggressive", 0.8);
  expect(summary.ambiguousWrites).toBeGreaterThan(0);
  expect(summary.suppressed!["ambiguous-write"]).toBe(summary.ambiguousWrites);
  expect(summary.ambiguousWriteRetries).toBe(0);
}, 20000);

test("repeating a saved canvas input yields identical complete evidence and causal chain", () => {
  const replay = runRetryStudy("transient", "bounded"), original = study("transient", "bounded");
  expect(replay.evidence).toEqual(original.evidence);
  expect(replay.summary).toEqual(original.summary); expect(replay.chain).toEqual(original.chain);
});

