import { expect, test } from "bun:test";
import { asyncSettingsError, DEFAULT_ASYNC_QUEUE_SETTINGS } from "../src/resource";

test("queue live-message capacity is an optional bounded integer for its owning resource", () => {
  expect(DEFAULT_ASYNC_QUEUE_SETTINGS).not.toHaveProperty("capacityMessages");
  for (const capacityMessages of [1, 3, 100000]) expect(asyncSettingsError("Message Queue", { ...DEFAULT_ASYNC_QUEUE_SETTINGS, capacityMessages })).toBeUndefined();
  for (const capacityMessages of [0, -1, 100001, 1.1, NaN, Infinity]) expect(asyncSettingsError("Message Queue", { ...DEFAULT_ASYNC_QUEUE_SETTINGS, capacityMessages })).toBeDefined();
  expect(asyncSettingsError("Virtual Machine", { ...DEFAULT_ASYNC_QUEUE_SETTINGS, capacityMessages: 3 })).toBeDefined();
  expect(asyncSettingsError("Virtual Machine", undefined, { enabled: true, concurrency: 1, prefetch: 1, cpuMsPerJob: 250, ...{ capacityMessages: 3 } })).toBeDefined();
});
