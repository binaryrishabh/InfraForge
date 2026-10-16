import { expect, test } from "bun:test";
import { EventKernel } from "../src/model2/time";
import { objectStore } from "../src/model2/async/objects";
import type { ObjectConfig, ObjectRequest } from "../src/model2/async/contracts";
import type { Invocation } from "../src/model2/workload/contracts";
import type { MeteringConfig, RuntimeUsageObserver } from "../src/reality/metering/contracts";
import { usageJournal } from "../src/reality/metering/journal";
import { usageWindow } from "../src/reality/metering/windows";
import { combineUsageWindows } from "../src/reality/metering/combine";
import { replayUsage } from "../src/reality/metering/replay";
import { asyncFixture } from "./asyncFixture";
import { providerHasher } from "./providerFixture";

function fixture(options: { maxRecords?: number; capacity?: number; zeroCpu?: boolean; drop?: number; caseId?: number } = {}) {
  const config = asyncFixture().resources.find((r): r is ObjectConfig => r.kind === "object-store")!;
  const known = (value: number) => ({ kind: "known" as const, value, unit: "bytes" as const, provenance: ["Authored deterministic usage verification"] });
  config.initial = [{ namespace: "n", key: "k", generation: 2, bytes: known(10), content: "seed" }];
  if (options.capacity !== undefined) config.capacity = known(options.capacity);
  if (options.zeroCpu) for (const demand of Object.values(config.demands)) demand.cpu = { ...demand.cpu, value: 0 } as typeof demand.cpu;
  const settings: MeteringConfig = { schema: "infraforge-usage-metering/1", run: `direct-object-verification-${options.caseId ?? 0}`, epoch: "execution-1", inputFingerprint: providerHasher.hash(JSON.stringify({ config, case: options.caseId ?? 0 })), provenance: ["Authored object-service schedule in meteringJournal.test.ts"], objects: ["objects"], links: [], maxRecords: options.maxRecords ?? 1000, maxFields: 50000, maxTextCharacters: 500000 };
  const journal = usageJournal(settings, providerHasher), kernel = new EventKernel(10000);
  const observer: RuntimeUsageObserver = options.drop === undefined ? journal.observer : { select: journal.observer.select, attach(source, head) { const sink = journal.observer.attach(source, head); return (r) => { if (r.sequence !== options.drop) sink(r); }; } };
  const store = objectStore(config, kernel, observer), replies: unknown[] = [];
  let sequence = 0;
  function submit(request: ObjectRequest) { const callId = JSON.stringify(["usage", ++sequence]); const work: Invocation = { rootId: "one-logical-verification", callId, offeredAt: kernel.now, attempt: sequence, operation: "heavy", message: { request } }; return store.accept(work, () => replies.push(work.message!.response)); }
  const put = (bytes: number, extra: Partial<ObjectRequest> = {}): ObjectRequest => ({ kind: "put", namespace: "n", key: "k", bytes, content: `value-${bytes}`, ...extra });
  return { config, settings, journal, kernel, store, replies, submit, put };
}
test("actual overwrites/deletion conserve retained bytes and exact independent byte-time", () => {
  const f = fixture(), start = f.journal.capture(0);
  f.kernel.schedule(0, 2, "put-a", () => f.submit(f.put(20)));
  f.kernel.schedule(20, 2, "put-b", () => f.submit(f.put(5)));
  f.kernel.schedule(40, 2, "delete", () => f.submit({ kind: "delete", namespace: "n", key: "k" }));
  f.kernel.advanceTo(15); const middle = f.journal.capture(15);
  f.kernel.advanceTo(60); const end = f.journal.capture(60), row = end.measurements[0]!;
  expect(end.complete).toBe(true); expect(row.family).toBe("object-store");
  if (row.family !== "object-store") throw Error("Wrong resource family");
  expect(row).toMatchObject({ storedBytes: "0", byteUs: "600", createdBytes: "25", releasedBytes: "35", committedPuts: "2", replacedObjects: "2", removedObjects: "1", generation: 4 });
  expect(row.operations).toMatchObject({ received: "3", completed: "3", live: "0" });
  expect(f.store.evidence().objects).toEqual([]);
  const all = usageWindow(start, end, providerHasher), left = usageWindow(start, middle, providerHasher), right = usageWindow(middle, end, providerHasher);
  expect(all.kind).toBe("Observed"); expect(combineUsageWindows([left, right], providerHasher)).toEqual(all);
  expect(replayUsage(f.journal.frame(end), providerHasher).matches).toBe(true);
});
test("zero-time commits retain mutation evidence and split by source cuts without fabricated time", () => {
  const f = fixture({ zeroCpu: true }), start = f.journal.capture(0);
  f.submit(f.put(20)); f.kernel.advanceTo(0); const middle = f.journal.capture(0);
  f.submit({ kind: "delete", namespace: "n", key: "k" }); f.kernel.advanceTo(0); const end = f.journal.capture(0);
  const all = usageWindow(start, end, providerHasher);
  expect(all.kind).toBe("Observed");
  if (all.kind !== "Observed") throw Error(all.reason);
  expect(all.quantities.find((q) => q.metric === "current-object.byte-time")!.value).toBe("0");
  expect(all.quantities.find((q) => q.metric === "operation.completed")!.value).toBe("2");
  expect(combineUsageWindows([usageWindow(start, middle, providerHasher), usageWindow(middle, end, providerHasher)], providerHasher)).toEqual(all);
  expect(f.journal.frame(end).records.filter((r) => r.detail.kind === "object-mutation")).toHaveLength(2);
});
test("failed conditional/capacity requests and cancelled work leave current storage intact", () => {
  const f = fixture({ capacity: 10 });
  f.submit(f.put(9, { ifAbsent: true })); f.kernel.advanceTo(10);
  f.submit(f.put(11)); f.kernel.advanceTo(20);
  const cancelled = f.submit(f.put(5)); f.kernel.advanceTo(25); cancelled.cancel(); f.kernel.advanceTo(40);
  const snapshot = f.journal.capture(40), row = snapshot.measurements[0]!;
  expect(snapshot.complete).toBe(true);
  expect(row).toMatchObject({ storedBytes: "10", byteUs: "400", committedPuts: "0", operations: { received: "3", failed: "2", cancelled: "1", completed: "0" } });
  expect(f.store.evidence().generation).toBe(2);
  expect(f.replies).toMatchObject([{ reason: "precondition-failed" }, { reason: "object-capacity" }, { reason: "cancelled" }]);
});
test("identical evidence delivery deduplicates while distinct retried requests remain distinct", () => {
  const f = fixture(); f.submit(f.put(20)); f.kernel.advanceTo(10); f.submit(f.put(20)); f.kernel.advanceTo(20);
  const frame = f.journal.frame(f.journal.capture(20));
  const replay = replayUsage(frame, providerHasher, [...frame.records].reverse().flatMap((r) => [r, structuredClone(r)]));
  expect(replay.matches).toBe(true);
  expect(replay.snapshot.measurements[0]).toMatchObject({ committedPuts: "2", operations: { received: "2", completed: "2" } });
});
test("missing trailing events are detected by producer watermarks without inventing a zero", () => {
  const f = fixture({ drop: 4 }), start = f.journal.capture(0); f.submit(f.put(20)); f.kernel.advanceTo(10);
  const end = f.journal.capture(10);
  expect(f.store.evidence().storedBytes).toBe(20); expect(end.complete).toBe(false);
  expect(end.reasons.join(";")).toContain("watermark"); expect(usageWindow(start, end, providerHasher).kind).toBe("Unknown");
});
test("retention overflow stays bounded and preserves earlier complete cuts", () => {
  const f = fixture({ maxRecords: 1 }), start = f.journal.capture(0); f.submit(f.put(20)); f.kernel.advanceTo(10);
  const end = f.journal.capture(10), frame = f.journal.frame(end);
  expect(end.complete).toBe(false); expect(frame.records).toHaveLength(1); expect(end.omittedRecords).toBeGreaterThan(0);
  expect(f.store.evidence().storedBytes).toBe(20); expect(usageWindow(start, end, providerHasher).kind).toBe("Unknown");
  expect(replayUsage(f.journal.frame(start), providerHasher).matches).toBe(true);
});
test("gaps, conflicting duplicates, late events, changed frames and reset epochs fail closed", () => {
  const f = fixture(), start = f.journal.capture(0); f.submit(f.put(20)); f.kernel.advanceTo(10); const end = f.journal.capture(10), frame = f.journal.frame(end);
  expect(replayUsage(frame, providerHasher, frame.records.slice(0, -1)).snapshot.complete).toBe(false);
  const conflict = structuredClone(frame.records[0]!); conflict.atUs = 1;
  expect(replayUsage(frame, providerHasher, [...frame.records, conflict]).snapshot.complete).toBe(false);
  const late = structuredClone(frame.records); late.at(-1)!.atUs = 1;
  expect(replayUsage(frame, providerHasher, late).snapshot.complete).toBe(false);
  const changed = structuredClone(frame); changed.records[0]!.atUs = 1;
  expect(() => replayUsage(changed, providerHasher)).toThrow("drift");
  const reset = structuredClone(end); reset.config.epoch = "new-execution";
  expect(usageWindow(start, reset, providerHasher).kind).toBe("Unknown");
});
test("duplicate/overlapping windows and missing provenance cannot become additive usage", () => {
  const f = fixture(), start = f.journal.capture(0); f.submit(f.put(20)); f.kernel.advanceTo(10); const mid = f.journal.capture(10); f.kernel.advanceTo(20); const end = f.journal.capture(20);
  const all = usageWindow(start, end, providerHasher), left = usageWindow(start, mid, providerHasher);
  expect(combineUsageWindows([all, all], providerHasher).kind).toBe("Unknown");
  expect(combineUsageWindows([left, all], providerHasher).kind).toBe("Unknown");
  const missing = structuredClone(start); missing.config.provenance = [];
  expect(usageWindow(missing, end, providerHasher).kind).toBe("Unknown");
});
test("512 actual object schedules match an independent state and byte-time oracle", () => {
  for (let id = 0; id < 512; id++) {
    const f = fixture({ capacity: 20, caseId: id }), start = f.journal.capture(0);
    let exists = true, bytes = 10, generation = 2, area = 0n, last = 0, failed = 0;
    for (let step = 0; step < 8; step++) {
      const action = (id + step) % 4, next = (id * 17 + step * 11) % 23, at = step * 30, commitAt = at + 10;
      const request: ObjectRequest = action === 1 ? { kind: "delete", namespace: "n", key: "k" } : action === 2 ? { kind: "head", namespace: "n", key: "k" } : f.put(next, action === 3 ? { ifAbsent: true } : {});
      f.kernel.schedule(at, 2, `case-${id}-${step}`, () => f.submit(request));
      area += BigInt(bytes) * BigInt(commitAt - last); last = commitAt;
      if (action === 1) { exists = false; bytes = 0; }
      else if (action === 2) { if (!exists) failed++; }
      else if (action === 3 && exists || next > 20) failed++;
      else { exists = true; bytes = next; generation++; }
    }
    f.kernel.advanceTo(120); const middle = f.journal.capture(120);
    f.kernel.advanceTo(240); const end = f.journal.capture(240); area += BigInt(bytes) * BigInt(240 - last);
    expect(end.complete).toBe(true);
    expect(end.measurements[0]).toMatchObject({ storedBytes: String(bytes), byteUs: String(area), generation, operations: { received: "8", failed: String(failed), completed: String(8 - failed), live: "0" } });
    expect(f.store.evidence().objects.length).toBe(exists ? 1 : 0);
    expect(combineUsageWindows([usageWindow(start, middle, providerHasher), usageWindow(middle, end, providerHasher)], providerHasher)).toEqual(usageWindow(start, end, providerHasher));
  }
}, 30000);
