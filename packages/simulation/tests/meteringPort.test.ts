import { expect, test } from "bun:test";
import { EventKernel } from "../src/model2/time";
import { objectStore } from "../src/model2/async/objects";
import { networkLink } from "../src/model2/network/link";
import type { ObjectConfig } from "../src/model2/async/contracts";
import type { Invocation } from "../src/model2/workload/contracts";
import type { RuntimeUsageObserver, UsageRecord, UsageSource } from "../src/reality/metering/contracts";
import { asyncFixture } from "./asyncFixture";

function observed() {
  const records: UsageRecord[] = [], sources: UsageSource[] = [], heads: Array<() => number> = [];
  const observer: RuntimeUsageObserver = {
    select: () => true,
    attach(source, head) { sources.push(source); heads.push(head); return (record) => records.push(structuredClone(record)); }
  };
  return { observer, records, sources, heads };
}
test("object ports follow real commits and rejected admission without changing retained state", () => {
  const config = asyncFixture().resources.find((r): r is ObjectConfig => r.kind === "object-store")!;
  config.initial = [{ namespace: "n", key: "k", generation: 3, bytes: { kind: "known", unit: "bytes", value: 7, provenance: ["Authored port verification seed"] }, content: "old" }];
  const kernel = new EventKernel(1000), log = observed(), store = objectStore(config, kernel, log.observer);
  const work: Invocation = { rootId: "root", callId: '["put"]', operation: "heavy", attempt: 1, offeredAt: 0, message: { request: { kind: "put", namespace: "n", key: "k", bytes: 11, content: "new" } } };
  store.accept(work, () => {}); kernel.advanceTo(10);
  expect(store.evidence().objects).toEqual([{ namespace: "n", key: "k", bytes: 11, generation: 4, content: "new" }]);
  expect(log.records.map((r) => r.detail.kind)).toEqual(["object-origin", "operation-start", "object-mutation", "operation-end"]);
  expect(log.records.map((r) => [r.sequence, r.atUs])).toEqual([[1, 0], [2, 0], [3, 10], [4, 10]]);
  store.pause(true); store.accept({ ...work, callId: '["rejected"]' }, () => {});
  expect(log.records.at(-1)?.detail).toMatchObject({ kind: "operation-end", request: 2, outcome: "rejected" });
  expect(store.evidence().storedBytes).toBe(11);
  expect(log.heads[0]!()).toBe(6);
});
test("link ports retain actual endpoints, context and rejected attempts independently of trace retention", () => {
  const base = asyncFixture().links[0]!, log = observed(), kernel = new EventKernel(1000);
  const link = networkLink({ ...base, id: "wire", from: "a", to: "b", bandwidth: { kind: "known", value: 1000000, unit: "bytes/s", provenance: ["Authored one-byte-per-microsecond verification"] }, propagation: { kind: "known", value: 0, unit: "us", provenance: ["Authored zero propagation verification"] } }, kernel, undefined, log.observer);
  link.transmit("delivery", 10, () => {}, { path: "p", direction: "response", hop: 1, origin: "a", destination: "b", callId: "call", rootId: "root", attempt: 2 });
  kernel.advanceTo(10); link.partition(true); link.transmit("rejected", 5, () => {});
  expect(link.measure()).toMatchObject({ deliveredBytes: 10, rejectedBytes: 5 });
  expect(log.sources[0]).toMatchObject({ family: "link", resource: "wire", from: "a", to: "b" });
  expect(log.records.map((r) => r.detail.kind)).toEqual(["transfer-start", "transfer-end", "transfer-start", "transfer-end"]);
  expect(log.records[0]!.detail).toMatchObject({ accepted: true, context: { direction: "response", hop: 1, attempt: 2 } });
  expect(log.records[2]!.detail).toMatchObject({ accepted: false, context: null });
  expect(log.heads[0]!()).toBe(4);
});
