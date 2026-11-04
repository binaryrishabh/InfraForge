import { expect, test } from "bun:test";
import { resolveScheduler, schedulerError } from "../src/resource/Scheduler.interface";

test("scheduler defaults and bounded one-time or recurring intent", () => {
  expect(resolveScheduler().periodMs).toBe(1000);
  expect(schedulerError("Scheduler", { version: 1, periodMs: 0, overlap: "queue", queueCapacity: 1 })).toBeUndefined();
  expect(schedulerError("Virtual Machine", undefined)).toBeUndefined();
});
test("scheduler refuses wrong owners, unknown fields and unbounded policy", () => {
  expect(schedulerError("Virtual Machine", { version: 1 })).toBeDefined();
  for (const patch of [{ version: 2 }, { extra: true }, { periodMs: -1 }, { periodMs: 0.1 }, { startMs: Infinity }, { maxTriggers: 10001 }, { maxConcurrent: 0 }, { queueCapacity: 129 }, { maxAttempts: 11 }, { overlap: "drop" }, { missed: "all" }, { operation: "delete" }, { maxLatenessMs: NaN }]) expect(schedulerError("Scheduler", { version: 1, ...patch })).toBeDefined();
});
