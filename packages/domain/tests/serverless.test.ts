import { expect, test } from "bun:test";
import { serverlessError, resolveServerless } from "../src/resource/Serverless.interface";
test("serverless settings are owned, versioned and bounded educational assumptions", () => {
  expect(resolveServerless()).toEqual({ concurrency: 16, initializationMs: 100, durationMs: 10, timeoutMs: 1000, idleExpiryMs: 10000, failurePercent: 0 });
  expect(serverlessError("Serverless Function", { version: 1, initializationMs: 0, concurrency: 128 })).toBeUndefined();
  expect(serverlessError("Virtual Machine", { version: 1 })).toBeDefined();
  expect(serverlessError("Virtual Machine", undefined)).toBeUndefined();
  for (const patch of [{ version: 2 }, { extra: true }, { concurrency: 129 }, { durationMs: 0 }, { timeoutMs: Infinity }, { initializationMs: -1 }, { idleExpiryMs: 0 }, { failurePercent: 101 }, { failurePercent: 0.1 }]) expect(serverlessError("Serverless Function", { version: 1, ...patch })).toBeDefined();
});
