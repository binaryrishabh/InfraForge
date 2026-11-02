import { expect, test } from "bun:test";
import { prepareMemory, tightMemory } from "./vmMemory.fixture";
import { createLiveModel2 } from "../src/model2/product/live";

test("memory evidence and live blocks exist only for authored VMs and headroom is exact", () => {
  for (const enabled of [false, true]) {
    const f = prepareMemory(true, enabled ? tightMemory : undefined), live = createLiveModel2(f.compiled, f.design.resources.map(r => r.id));
    live.advanceSecond(); const view = live.project(), evidence = live.evidence();
    if (!enabled) { expect(evidence).not.toHaveProperty("vmMemory"); expect(view.metrics.app).not.toHaveProperty("vmMemory"); continue; }
    expect(view.metrics.app!.vmMemory!.resources).toHaveLength(1);
    const reading = view.metrics.app!.vmMemory!.resources[0]!;
    expect(reading.headroomBytes).toBe(reading.limitBytes! - reading.residentBytes!);
    expect(reading.peakResidentBytes).toBe(2048 * 1048576);
    expect(reading.allocationRejected).toBeGreaterThan(0);
    expect(reading.comparison).toBe("within");
    expect(evidence.vmMemory!.resources).toEqual(view.metrics.app!.vmMemory!.resources);
    expect(view.metrics.db).not.toHaveProperty("vmMemory");
    live.advanceSecond(); const later = live.project().metrics.app!.vmMemory!.resources[0]!;
    expect(later.peakResidentBytes).toBeGreaterThanOrEqual(reading.peakResidentBytes!);
  }
});
test("transition peak and evidence are identical for one-shot and stepped playback", () => {
  const f = prepareMemory(false, { ...tightMemory, activeMiB: 16 }), stepped = f.make();
  f.runtime.advanceTo(3000000); for (let at = 1000; at <= 3000000; at += 1000) stepped.advanceTo(at);
  expect(stepped.evidence()).toEqual(f.runtime.evidence());
  const reading = f.runtime.evidence().vmMemory!.resources[0]!;
  expect(reading.peakResidentBytes).toBeGreaterThanOrEqual(reading.residentBytes!);
  expect(reading.peakResidentBytes).toBeLessThanOrEqual(reading.limitBytes!);
});
