import { expect, test } from "bun:test";
import { meteringFixture } from "./meteringFixture";
import { providerHasher } from "./providerFixture";
import { createProviderModel2 } from "../src/reality/provider/run";
import { createMeteredProviderModel2 } from "../src/reality/metering/run";
import { compileProviderProduct } from "../src/reality/provider/compile";
import { usageWindow } from "../src/reality/metering/windows";
import { replayUsage } from "../src/reality/metering/replay";

test("compiled saved product observes real storage, operations and directed payload without changing execution", () => {
  const f = meteringFixture(), plain = createProviderModel2(f.compiled, providerHasher), metered = createMeteredProviderModel2(f.compiled, f.config, providerHasher);
  const start = metered.evidence();
  expect(start.usage.complete).toBe(true);
  for (const at of [100, 2500, 6000, 120000]) {
    plain.advanceTo(at); metered.advanceTo(at);
    const actual = metered.evidence(), reference = plain.evidence();
    expect(actual.model).toEqual(reference.model); expect(actual.provider).toEqual(reference.provider);
    expect(actual.usage.complete).toBe(true);
  }
  const end = metered.evidence(), window = usageWindow(start.usage, end.usage, providerHasher), frame = metered.frame();
  expect(window.kind).toBe("Observed");
  expect(end.usage.measurements.some((m) => m.family === "object-store" && BigInt(m.committedPuts) > 1n)).toBe(true);
  expect(frame.records.some((r) => r.detail.kind === "object-mutation" && r.detail.command === "delete")).toBe(true);
  expect(frame.records.some((r) => r.detail.kind === "transfer-start" && r.detail.context?.direction === "response" && r.detail.context.origin === "objects")).toBe(true);
  expect(replayUsage(frame, providerHasher).matches).toBe(true);
  expect(end.model.systems.commands.results.find((r) => r.id === "usage-read")!.reply).toMatchObject({ ok: true, object: { namespace: "usage", key: "key", bytes: 17, content: "v2" } });
  expect(end.model.systems.commands.results.find((r) => r.id === "usage-delete")!.reply).toMatchObject({ ok: true, deleted: true });
  expect(end.model.systems.commands.results.find((r) => r.id === "usage-missing")!.reply).toMatchObject({ ok: false, reason: "not-found" });
  expect(end.provider.total.kind).toBe("Unknown");
});
test("failed response delivery can leave an actual successful server commit", () => {
  const f = meteringFixture({ responseLoss: true }), runtime = createMeteredProviderModel2(f.compiled, f.config, providerHasher);
  runtime.advanceTo(runtime.horizon); const e = runtime.evidence();
  expect(e.usage.complete).toBe(true);
  expect(e.model.systems.commands.results.some((r) => r.id === "usage-create" && r.outcome !== "completed")).toBe(true);
  expect(e.model.asynchronous.objects[0]!.objects.some((r) => r.namespace === "usage" && r.key === "retained" && r.bytes === 23)).toBe(true);
  expect(e.usage.measurements.some((m) => m.family === "link" && BigInt(m.totals.failedBytes) > 0n)).toBe(true);
});
test("collector overflow makes usage Unknown while real model behavior and existing compute estimates remain unchanged", () => {
  const f = meteringFixture({ maxRecords: 1 }), metered = createMeteredProviderModel2(f.compiled, f.config, providerHasher), plain = createProviderModel2(f.compiled, providerHasher);
  metered.advanceTo(metered.horizon); plain.advanceTo(plain.horizon);
  const e = metered.evidence(), reference = plain.evidence();
  expect(e.model).toEqual(reference.model); expect(e.provider).toEqual(reference.provider);
  expect(e.usage.complete).toBe(false); expect(metered.frame().records.length).toBeLessThanOrEqual(1);
});
test("unknown selections, wrong inputs and provider scope drift refuse before runtime activation", () => {
  const f = meteringFixture();
  expect(() => createMeteredProviderModel2(f.compiled, { ...f.config, objects: ["missing"] }, providerHasher)).toThrow("selection");
  expect(() => createMeteredProviderModel2(f.compiled, { ...f.config, inputFingerprint: "0".repeat(64) }, providerHasher)).toThrow("input");
  f.compiled.provider.hosts[0]!.scope.region = "aws:aws:unknown";
  expect(() => createMeteredProviderModel2(f.compiled, f.config, providerHasher)).toThrow("drift");
});
test("logical storage retains real generations across process outage and serves them after recovery", () => {
  const f = meteringFixture({ outage: true }), runtime = createMeteredProviderModel2(f.compiled, f.config, providerHasher);
  runtime.advanceTo(4500); const before = runtime.evidence();
  runtime.advanceTo(6000); const during = runtime.evidence();
  expect(during.usage.complete).toBe(true);
  expect(during.model.asynchronous.objects[0]!.objects).toEqual(before.model.asynchronous.objects[0]!.objects);
  runtime.advanceTo(20000); const after = runtime.evidence();
  expect(after.usage.complete).toBe(true);
  expect(after.model.systems.commands.results.some((r) => r.id === "usage-during-outage")).toBe(false);
  expect(after.model.systems.commands.results.find((r) => r.id === "usage-after-recovery")!.reply).toMatchObject({ ok: true, object: { key: "retained", bytes: 23, content: "retained" } });
  expect(after.provider.total.kind).toBe("Unknown");
  runtime.advanceTo(36000);
  expect(runtime.evidence().model.systems.commands.results.find((r) => r.id === "usage-during-outage")).toMatchObject({ at: 36000, outcome: "rejected", reply: null });
});
test("real capacity rejection carries request payload but does not invent a storage overwrite", () => {
  const f = meteringFixture({ capacity: true }), runtime = createMeteredProviderModel2(f.compiled, f.config, providerHasher);
  runtime.advanceTo(2500); const e = runtime.evidence();
  expect(e.usage.complete).toBe(true);
  expect(e.model.systems.commands.results.find((r) => r.id === "usage-overwrite")!.reply).toMatchObject({ ok: false, reason: "object-capacity" });
  expect(e.model.asynchronous.objects[0]!.objects.find((r) => r.namespace === "usage" && r.key === "key")).toMatchObject({ bytes: 8, content: "v1" });
  const frame = runtime.frame();
  expect(frame.records.some((r) => r.detail.kind === "transfer-start" && r.detail.bytes >= 4096)).toBe(true);
});

test("actual execution budget interruption makes usage Unknown and refuses continuation", () => {
  const f = meteringFixture(); f.contract.limits.maxEvents = 500;
  const compiled = compileProviderProduct(f, f.provider, f.snapshot, providerHasher);
  const runtime = createMeteredProviderModel2(compiled, { ...f.config, inputFingerprint: compiled.fingerprint }, providerHasher), start = runtime.evidence();
  expect(start.usage.complete).toBe(true);
  expect(() => runtime.advanceTo(runtime.horizon)).toThrow("Event budget exhausted");
  const stopped = runtime.evidence();
  expect(stopped.model.capture.reachedHorizon).toBe(false);
  expect(stopped.model.capture.failure).toContain("Event budget exhausted");
  expect(stopped.usage.complete).toBe(false);
  expect(usageWindow(start.usage, stopped.usage, providerHasher).kind).toBe("Unknown");
  expect(replayUsage(runtime.frame(), providerHasher).snapshot.complete).toBe(false);
  expect(stopped.provider.total.kind).toBe("Unknown");
  expect(() => runtime.advanceTo(runtime.horizon)).toThrow("Failed execution cannot resume");
});
