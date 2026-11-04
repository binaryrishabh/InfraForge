import { expect, test } from "bun:test";
import { asyncSettingsError, DEFAULT_ASYNC_WORKER_SETTINGS, DEFAULT_ASYNC_QUEUE_SETTINGS } from "../src/resource";

test("acknowledgement delay is optional, bounded integer worker intent, including disabled settings", () => {
  expect(DEFAULT_ASYNC_WORKER_SETTINGS).not.toHaveProperty("acknowledgementDelayMs");
  for (const enabled of [true, false]) {
    for (const acknowledgementDelayMs of [undefined, 0, 1, 2000, 60000]) expect(asyncSettingsError("Virtual Machine", undefined, { ...DEFAULT_ASYNC_WORKER_SETTINGS, enabled, acknowledgementDelayMs })).toBeUndefined();
    for (const acknowledgementDelayMs of [null, -1, 0.5, 60001, Infinity, NaN, "2000", true, {}, []]) expect(asyncSettingsError("Virtual Machine", undefined, { ...DEFAULT_ASYNC_WORKER_SETTINGS, enabled, acknowledgementDelayMs } as never)).toBeDefined();
  }
  expect(asyncSettingsError("Database", undefined, { ...DEFAULT_ASYNC_WORKER_SETTINGS, acknowledgementDelayMs: 2000 })).toBeDefined();
  expect(asyncSettingsError("Message Queue", { ...DEFAULT_ASYNC_QUEUE_SETTINGS, acknowledgementDelayMs: 2000 } as never)).toBeDefined();
});
