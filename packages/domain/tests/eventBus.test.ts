import { expect, test } from "bun:test";
import { eventBusError, resolveEventBus } from "../src/resource/EventBus.interface";

test("event bus settings preserve stable defaults and accept bounded subscription intent", () => {
  expect(resolveEventBus()).toEqual({ capacityMessages: 1000, maxAttempts: 3, retryDelayMs: 100, deliveryTimeoutMs: 1000, deadLetterCapacity: 100 });
  expect(eventBusError("Event Bus", { version: 1, capacityMessages: 1, subscriptions: [{ id: "s", edge: "e", filter: { keyPrefix: "order" } }] })).toBeUndefined();
});
test("event bus settings reject wrong owners, unknown fields, duplicate subscriptions and unbounded values", () => {
  expect(eventBusError("Virtual Machine", { version: 1 })).toBeDefined();
  for (const settings of [{ version: 2 }, { version: 1, extra: true }, { version: 1, capacityMessages: 0 }, { version: 1, maxAttempts: 11 }, { version: 1, retryDelayMs: NaN }, { version: 1, deliveryTimeoutMs: Infinity }, { version: 1, subscriptions: [{ id: "s", edge: "e" }, { id: "s", edge: "f" }] }, { version: 1, subscriptions: [{ id: "s", edge: "e", filter: { keyPrefix: "" } }] }]) expect(eventBusError("Event Bus", settings)).toBeDefined();
  expect(eventBusError("Virtual Machine", undefined)).toBeUndefined();
});
