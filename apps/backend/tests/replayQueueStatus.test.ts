import { expect, test } from "bun:test";
import { queueStatus, REPLAY_SECONDS_PER_SIMULATED_SECOND, type ReplayQueueRow } from "../replay/queueStatus";

const limits = { active: 2, queued: 20 };
const row = (id: string, status = "pending", seconds: unknown = 100, order = 0): ReplayQueueRow => ({
  id, status, createdAt: new Date(0), updatedAt: new Date(order), browserSubmission: { stopAtSecond: seconds, actions: [] },
});

test("zero, one and many runs ahead use total costs / slots + own cost", () => {
  expect(REPLAY_SECONDS_PER_SIMULATED_SECOND).toBe(0.15);
  for (const active of [1, 2]) {
    for (const ahead of [0, 1, 5]) {
      const rows = Array.from({ length: ahead }, (_, i) => row(`ahead-${i}`, "pending", 200, i));
      rows.push(row("target", "pending", 100, 10));
      expect(queueStatus("target", rows, { ...limits, active })).toMatchObject({ state: "queued", position: ahead + 1,
        runsAhead: ahead, estimatedWaitSeconds: ahead * 30 / active + 15 });
    }
  }
});

test("active replays precede queued work, but do not increase queued position", () => {
  const rows = [row("target", "pending", 100, 5), row("active", "running", 200, 9), row("first", "pending", 300)];
  expect(queueStatus("target", rows, limits)).toMatchObject({ state: "queued", position: 2, runsAhead: 2, estimatedWaitSeconds: 52.5 });
  expect(queueStatus("active", rows, limits)).toMatchObject({ state: "replaying", position: null, runsAhead: 0, estimatedWaitSeconds: 30 });
});

test("ordering uses updatedAt then createdAt then id and never mutates its input", () => {
  const rows = [row("target", "pending", 100, 2), row("b", "pending", 200, 2), row("z", "pending", 100, 1), row("later", "pending", null, 3)];
  rows[1]!.createdAt = new Date(1);
  const before = JSON.stringify(rows);
  expect(queueStatus("target", rows, limits)).toMatchObject({ position: 2, runsAhead: 1, estimatedWaitSeconds: 22.5 });
  rows[1]!.createdAt = new Date(0);
  expect(queueStatus("target", rows, limits)).toMatchObject({ position: 3, runsAhead: 2, estimatedWaitSeconds: 37.5 });
  rows[1]!.createdAt = new Date(1);
  expect(JSON.stringify(rows)).toBe(before);
});

test("missing, malformed or out-of-range required stop seconds stay Unknown", () => {
  for (const duration of [undefined, null, "100", NaN, Infinity, 0, -1, 1.5, 3601]) {
    for (const own of [false, true]) {
      const rows = [row("first", "running", 200), row("target", "pending", 100)];
      rows[own ? 1 : 0]!.browserSubmission = { stopAtSecond: duration, actions: [] };
      const status = queueStatus("target", rows, limits);
      expect(status).toMatchObject({ state: "queued", position: 1, runsAhead: 1, estimatedWaitSeconds: null });
      expect(status.basis).toContain("Unknown");
    }
  }
  for (const submission of [null, "{", '{"stopAtSecond":100}', [], {}, { stopAtSecond: "100" }]) {
    expect(queueStatus("target", [{ ...row("target"), browserSubmission: submission }], limits).estimatedWaitSeconds).toBeNull();
  }
});

test("absent runs, duplicates, incomplete snapshots and invalid limits never invent counts", () => {
  const unknown = { state: "unknown", position: null, runsAhead: null, estimatedWaitSeconds: null };
  expect(queueStatus("target", [], limits)).toMatchObject(unknown);
  expect(queueStatus("target", [row("target", "completed")], limits)).toMatchObject(unknown);
  expect(queueStatus("target", [row("target"), row("target")], limits)).toMatchObject(unknown);
  expect(queueStatus("target", [row("target"), { ...row("bad"), updatedAt: new Date(NaN) }], limits)).toMatchObject(unknown);
  expect(queueStatus("target", [row("target"), row("other")], { active: 1, queued: 1 })).toMatchObject(unknown);
  for (const active of [0, -1, NaN, Infinity, 1.5]) expect(queueStatus("target", [row("target")], { active, queued: 20 })).toMatchObject(unknown);
});

test("other server work makes the duration unknown without hiding observed replay position", () => {
  const blocker = { ...row("gates", "running"), browserSubmission: null };
  const status = queueStatus("target", [row("target"), blocker], limits);
  expect(status).toMatchObject({ state: "queued", position: 1, runsAhead: 1, estimatedWaitSeconds: null });
  expect(status.basis).toContain("Unknown");
});

test("basis discloses the formula, rough development measurement, ordering and full active costs", () => {
  const status = queueStatus("target", [row("target")], limits);
  for (const text of ["0.15", "2 active slots", "own", "development PC", "sample design", "rough guide", "updatedAt", "progress", "promise"]) expect(status.basis).toContain(text);
});
