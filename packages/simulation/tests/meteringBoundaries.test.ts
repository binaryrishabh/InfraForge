import { expect, test } from "bun:test";
import { EventKernel } from "../src/model2/time";
import { objectStore } from "../src/model2/async/objects";
import { networkLink } from "../src/model2/network/link";
import type { ObjectConfig } from "../src/model2/async/contracts";
import type { MeteringConfig } from "../src/reality/metering/contracts";
import { usageJournal } from "../src/reality/metering/journal";
import { usageWindow } from "../src/reality/metering/windows";
import { combineUsageWindows } from "../src/reality/metering/combine";
import { replayUsage } from "../src/reality/metering/replay";
import { digest } from "../src/reality/provider/fingerprint";
import { asyncFixture } from "./asyncFixture";
import { providerHasher } from "./providerFixture";

function fixture() {
  const base = asyncFixture(), store = base.resources.find((r): r is ObjectConfig => r.kind === "object-store")!;
  store.initial = [{ namespace: "n", key: "k", generation: 1, bytes: { kind: "known", value: 10, unit: "bytes", provenance: ["Authored boundary seed"] }, content: "seed" }];
  const config: MeteringConfig = { schema: "infraforge-usage-metering/1", run: "boundary-verification", epoch: "one", inputFingerprint: digest(base, providerHasher), provenance: ["Authored actual resource boundary verification"], objects: ["objects"], links: [], maxRecords: 1000, maxFields: 50000, maxTextCharacters: 500000 };
  return { base, store, config, kernel: new EventKernel(10000) };
}
function resign<T extends { fingerprint: string }>(value: T): T { const { fingerprint, ...body } = value; void fingerprint; return { ...body, fingerprint: digest(body, providerHasher) } as T; }

test("distinct store owners preserve exact large byte-time and cannot duplicate shared ownership", () => {
  const f = fixture(); f.config.objects.push("second");
  f.store.initial[0]!.bytes = { kind: "known", value: Number.MAX_SAFE_INTEGER, unit: "bytes", provenance: ["Authored exact integer boundary"] };
  const journal = usageJournal(f.config, providerHasher);
  objectStore(f.store, f.kernel, journal.observer);
  const second = structuredClone(f.store); second.id = "second"; second.initial[0]!.bytes = { kind: "known", value: 3, unit: "bytes", provenance: ["Authored second store"] };
  objectStore(second, f.kernel, journal.observer);
  const start = journal.capture(0); f.kernel.advanceTo(Number.MAX_SAFE_INTEGER); const end = journal.capture(f.kernel.now);
  expect(end.complete).toBe(true);
  expect(end.measurements[0]).toMatchObject({ byteUs: String(BigInt(Number.MAX_SAFE_INTEGER) ** 2n) });
  expect(end.measurements[1]).toMatchObject({ byteUs: String(3n * BigInt(Number.MAX_SAFE_INTEGER)) });
  expect(usageWindow(start, end, providerHasher).kind).toBe("Observed");
  objectStore(second, f.kernel, journal.observer);
  expect(journal.capture(f.kernel.now).complete).toBe(false);
});

test("one shared directed link conserves live, delivered, aborted, partitioned and zero-byte transfers", () => {
  const f = fixture(); f.config.objects = []; f.config.links = ["shared"];
  const journal = usageJournal(f.config, providerHasher), link = networkLink({ ...f.base.links[0]!, id: "shared", from: "a", to: "b", bandwidth: { kind: "known", value: 1000000, unit: "bytes/s", provenance: ["Authored 1 byte/us"] } }, f.kernel, undefined, journal.observer);
  const start = journal.capture(0), context = { path: "one", direction: "request" as const, hop: 0, origin: "a", destination: "b", callId: "call", rootId: "root", attempt: 1 };
  const cancel = link.transmit("first", 10, () => {}, context);
  link.transmit("second", 20, () => {}, { ...context, path: "two", callId: "other" });
  f.kernel.advanceTo(5); const middle = journal.capture(5); cancel();
  f.kernel.advanceTo(50); link.transmit("zero", 0, () => {}, context); f.kernel.advanceTo(60);
  link.transmit("partitioned", 7, () => {}, context); link.partition(true); link.transmit("rejected", 3, () => {});
  const end = journal.capture(60);
  expect(end.complete).toBe(true);
  expect(end.measurements[0]).toMatchObject({ totals: { offeredBytes: "40", acceptedBytes: "37", deliveredBytes: "20", failedBytes: "17", rejectedBytes: "3", liveBytes: "0", offeredTransfers: "5", terminalTransfers: "5" }, providerBillableTransfer: "Unknown" });
  expect(combineUsageWindows([usageWindow(start, middle, providerHasher), usageWindow(middle, end, providerHasher)], providerHasher)).toEqual(usageWindow(start, end, providerHasher));
  expect(replayUsage(journal.frame(end), providerHasher).matches).toBe(true);
});

test("field/text budgets, missing sources, interrupted execution and producer reset remain Unknown", () => {
  for (const budget of [{ maxFields: 1 }, { maxTextCharacters: 1 }]) {
    const f = fixture(), journal = usageJournal({ ...f.config, ...budget }, providerHasher);
    const store = objectStore(f.store, f.kernel, journal.observer), snapshot = journal.capture(0);
    expect(store.evidence().objects.length).toBeGreaterThan(0); expect(snapshot.complete).toBe(false); expect(journal.frame(snapshot).records).toHaveLength(0);
  }
  const f = fixture(), journal = usageJournal(f.config, providerHasher);
  expect(journal.capture(0).complete).toBe(false);
  objectStore(f.store, f.kernel, journal.observer);
  const start = journal.capture(0), interrupted = journal.capture(0, "event budget exhausted");
  expect(usageWindow(start, interrupted, providerHasher).kind).toBe("Unknown");
  const frame = journal.frame(start); frame.snapshot.sources[0]!.producerHead = 0; frame.snapshot = resign(frame.snapshot);
  expect(replayUsage(resign(frame), providerHasher).snapshot.complete).toBe(false);
});

test("rehashing cannot convert missing coverage, reset epochs, wrong counts or retained accounting into valid usage", () => {
  const f = fixture(), journal = usageJournal(f.config, providerHasher); objectStore(f.store, f.kernel, journal.observer);
  const start = journal.capture(0); f.kernel.advanceTo(10); const end = journal.capture(10);
  const missing = structuredClone(end); missing.sources = []; missing.measurements = [];
  expect(usageWindow(start, resign(missing), providerHasher).kind).toBe("Unknown");
  const reset = structuredClone(end); reset.config.epoch = "new";
  expect(usageWindow(start, resign(reset), providerHasher).kind).toBe("Unknown");
  const wrong = structuredClone(end), row = wrong.measurements[0]!;
  if (row.family !== "object-store") throw Error("Expected store"); row.operations.received = "1";
  expect(usageWindow(start, resign(wrong), providerHasher).kind).toBe("Unknown");
  const frame = journal.frame(end); frame.retained.fields++;
  expect(() => replayUsage(resign(frame), providerHasher)).toThrow("accounting");
  const duplicate = journal.frame(end); duplicate.records.push(duplicate.records[0]!);
  expect(() => replayUsage(resign(duplicate), providerHasher)).toThrow("Duplicate");
  expect(() => usageJournal({ ...f.config, provenance: [] }, providerHasher)).toThrow("provenance");
});
