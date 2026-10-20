import { expect, mock, test } from "bun:test";
import * as hostOs from "node:os";
import { firstStackCompileFixture } from "./first-stack-compile";

// Authored host availability for software contract tests, not an intended-host proof.
let availableBytes = 1024 ** 3;
mock.module("node:os", () => ({ ...hostOs, freemem: () => availableBytes }));
const { executeFirstStackBounded } = await import("../../apps/backend/firstStack/boundedExecution");

test("insufficient observed headroom refuses before any durable or modeled work", async () => {
  availableBytes = 1;
  try {
    const f = await firstStackCompileFixture(), result = await executeFirstStackBounded(f.prepare());
    expect(result.interruption!.kind).toBe("headroom");
    expect(result.durablePrefix).toBeNull(); expect(result.observedPrefix).toBeNull();
  } finally { availableBytes = 1024 ** 3; }
});

test("store failure retains exactly the last acknowledged cut", async () => {
  const f = await firstStackCompileFixture(); let calls = 0; let committed = "";
  const result = await executeFirstStackBounded(f.prepare(), { persist: async frame => { if (++calls === 2) throw Error("store unavailable"); committed = frame; } });
  expect(result.status).toBe("interrupted"); expect(result.durablePrefix).toEqual(JSON.parse(committed));
  expect(result.durablePrefix!.sequence).toBe(1); expect(result.durablePrefix!.throughUs).toBe(0);
  expect(result.interruption!.classification).toBe("executor-interrupted");
  expect(result.durablePrefix!.completeness.horizonReached).toBe(false);
  if (result.summary) {
    const summary = JSON.parse(result.summary);
    expect(summary.evidence.capture.throughUs).toBe(summary.prefix.throughUs);
    expect(summary.durablePrefix).toEqual(result.durablePrefix);
  }
});

test("cancellation and RSS/output/event exhaustion produce explicit partial prefixes", async () => {
  const f = await firstStackCompileFixture(); let cancelled = false;
  const cancel = await executeFirstStackBounded(f.prepare(), { cancelled: () => cancelled, persist: async () => { cancelled = true; } });
  expect(cancel.status).toBe("interrupted"); expect(cancel.interruption!.kind).toBe("cancelled");
  expect(cancel.durablePrefix!.counts.offered).toBe(0); expect(cancel.durablePrefix!.completeness.allRootsTerminal).toBe(false);
  const rss = await executeFirstStackBounded(f.prepare(), { maxRssBytes: 1 });
  expect(rss.interruption!.kind).toBe("rss"); expect(rss.durablePrefix).toBeNull();
  const output = await executeFirstStackBounded(f.prepare(), { maxFrameBytes: 1, persist: async () => {} });
  expect(output.interruption!.kind).toBe("output"); expect(output.durablePrefix).toBeNull();
  const total = await executeFirstStackBounded(f.prepare(), { maxCaptureBytes: 1, persist: async () => {} });
  expect(total.interruption!.kind).toBe("output"); expect(total.storedBytes).toBe(0);
  const cpu = await executeFirstStackBounded(f.prepare(), { maxCpuUs: 1 });
  expect(cpu.interruption!.kind).toBe("cpu"); expect(cpu.durablePrefix).toBeNull();
  const wall = await executeFirstStackBounded(f.prepare(), { maxWallMs: 1 });
  expect(wall.interruption!.kind).toBe("wall"); expect(wall.durablePrefix).toBeNull();
  await expect(executeFirstStackBounded(f.prepare(), { maxWallMs: 60001 })).rejects.toThrow("only lower");
  f.policy.maxEvents = 150;
  const events = await executeFirstStackBounded(f.prepare(), { persist: async () => {} });
  expect(events.status).toBe("interrupted"); expect(events.durablePrefix!.completeness.horizonReached).toBe(false);
  expect(events.interruption!.reason).toContain("budget");
});

test("successful bounded execution has explicit completeness and bounded sequential frames", async () => {
  const f = await firstStackCompileFixture(8), frames: string[] = [];
  const result = await executeFirstStackBounded(f.prepare(), { persist: async frame => { frames.push(frame); } });
  expect(result.status).toBe("completed"); expect(result.interruption).toBeNull();
  expect(result.durablePrefix!.completeness).toMatchObject({ horizonReached: true, allRootsTerminal: true, journalComplete: true });
  expect(result.durablePrefix!.counts.completed).toBe(24);
  expect(result.storedBytes).toBe(frames.reduce((sum, frame) => sum + Buffer.byteLength(frame), 0));
  expect(frames.every((frame, i) => Buffer.byteLength(frame) <= 1024 * 1024 && JSON.parse(frame).sequence === i + 1)).toBe(true);
  expect(result.summary).not.toBeNull();
  const summary = JSON.parse(result.summary!);
  expect(summary.evidence.counts.completed).toBe(24); expect(summary.evidence.firstStack.activeEngine).toBe("1");
  const small = await executeFirstStackBounded(f.prepare(), { maxSummaryBytes: 1, persist: async () => {} });
  expect(small.status).toBe("interrupted"); expect(small.interruption!.kind).toBe("output");
  expect(small.effectiveLimits.summaryBytes).toBe(1);
  expect(small.durablePrefix!.effectiveLimits).toEqual(small.effectiveLimits);
  expect(small.summary).toBeNull(); expect(small.durablePrefix!.completeness.horizonReached).toBe(true);
});
