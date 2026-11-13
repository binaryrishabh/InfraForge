import { expect, test } from "bun:test";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import { buildRunReport } from "../reports/report";
import { findLearningLesson } from "../learning/registry";
import { definition, answers, attemptRow } from "./challengeHarness";

// Near misses that are really valid alternative fixes: each lesson must say it is not the only fix, and the real engine must agree.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res = (s: ChallengeStarter, id: string) => s.resources.find(r => r.id === id)! as any;
function meets(id: string, edit: (s: ChallengeStarter) => void) {
  const d = definition(id), s = structuredClone(d.starter!); edit(s);
  return buildRunReport(attemptRow(d, s, answers(d, { health: "healthy", "overall-health": "healthy", scale: "yes" }))).challenge!.status;
}
const lessonText = (id: string) => { const l = findLearningLesson(id)!; return [...l.explanation, ...l.limitations].join(" "); };

test("release-the-cpu-budget: a larger instance also meets the requirement and the lesson says the limit is not the only lever", () => {
  expect(meets("release-the-cpu-budget", s => { res(s, "app").size = "large"; })).toBe("met");
  expect(lessonText("release-the-cpu-budget")).toContain("not the only fix");
});
test("isolate-route-credits: a shared refill near the call rate also admits the writes and the lesson says separate scopes are not the only fix", () => {
  expect(meets("isolate-route-credits", s => { for (const r of res(s, "gateway").apiGateway.routes) r.requestsPerSecond = 100; })).toBe("met");
  expect(lessonText("isolate-route-credits")).toContain("not the only fix");
});
test("scale-on-delivered-samples: a looser freshness bound also scales the pool and the lesson says export is not the only fix", () => {
  expect(meets("scale-on-delivered-samples", s => { res(s, "app").autoscaling.signal.freshForSeconds = 30; })).toBe("met");
  expect(lessonText("scale-on-delivered-samples")).toContain("not the only fix");
  expect(lessonText("trace-a-scaling-stall")).toContain("not the only fix");
});
test("keep-failed-events: capacity 50 meets the 50 floor but discards ten, so the wording says the list must hold every exhausted event", () => {
  expect(meets("keep-failed-events", s => { res(s, "bus").eventBus.deadLetterCapacity = 50; })).toBe("not-met");
  expect(meets("keep-failed-events", s => { res(s, "bus").eventBus.deadLetterCapacity = 60; })).toBe("met");
  expect(definition("keep-failed-events").objective).toContain("about 60");
});
