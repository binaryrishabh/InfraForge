import { expect, test } from "bun:test";
import { pairRetryRoots, runRetryStudy } from "./retryStudy";

test("the same root accounting proves retry rescues and retry overload without extra terminal successes", () => {
  const transientOff = runRetryStudy("slow-transient", "disabled"), transientOn = runRetryStudy("slow-transient", "bounded");
  const overloadOff = runRetryStudy("slow-sustained", "disabled"), overloadOn = runRetryStudy("slow-sustained", "aggressive");
  for (const r of [transientOff, transientOn, overloadOff, overloadOn]) {
    const s = r.summary;
    expect(s.duplicateCallerTerminals).toBe(0); expect(s.callerTerminals).toBe(s.originalRequests);
    expect(new Set(r.roots.map(root => root.root)).size).toBe(s.originalRequests);
    expect(r.roots.filter(root => root.outcome === "completed")).toHaveLength(s.caller.completed);
    expect(s.caller.offered).toBe(s.caller.completed + s.caller.rejected + s.caller.deadlineExceeded + s.caller.abandoned);
    expect(s.caller.inFlight).toBe(0); expect(s.maxConcurrentDbCopies).toBe(1);
  }
  const paired = pairRetryRoots(transientOff, transientOn);
  expect(paired.directRescues).toHaveLength(4); expect(paired.netGain).toBe(4);
  expect(overloadOn.summary.caller.completed).toBe(overloadOff.summary.caller.completed);
  expect(overloadOn.summary.peakDbQueued).toBeGreaterThan(overloadOff.summary.peakDbQueued);
  expect(overloadOn.summary.databaseCpuUs).toBeGreaterThan(overloadOff.summary.databaseCpuUs);
  expect(overloadOn.summary.drainAfterLoadFallUs).toBeGreaterThan(overloadOff.summary.drainAfterLoadFallUs);
  console.info("retry-help-harm", JSON.stringify({ help: { off: transientOff.summary.caller.completed, on: transientOn.summary.caller.completed, directRescues: paired.directRescues.length }, overload: { completions: overloadOn.summary.caller.completed, queue: [overloadOff.summary.peakDbQueued, overloadOn.summary.peakDbQueued], drainUs: [overloadOff.summary.drainAfterLoadFallUs, overloadOn.summary.drainAfterLoadFallUs], attempts: [overloadOff.summary.attempts, overloadOn.summary.attempts] } }));
}, 30000);
