import { expect, test } from "bun:test";
import { sixVmScenario } from "./sixVm.fixture";
import { hash } from "./keyspace.fixture";

test("six different VMs isolate overload, redistribute one failure, show the next limit, and recover deterministically", () => {
  const normal = sixVmScenario(false), failed = sixVmScenario(true);
  const settings = normal.design.resources.slice(1);
  expect(new Set(settings.map(r => r.vmExecution!.workers)).size).toBe(6);
  expect(new Set(settings.map(r => r.vmCpuQuota!.limitPercent)).size).toBe(6);
  const initial = failed.snapshots[0]!;
  expect(initial[0]!.rejected).toBeGreaterThan(0); expect(initial.slice(1).every(s => s.rejected === 0)).toBe(true);
  expect(failed.removed).toBeNumber(); expect(failed.returned).toBeNumber();
  const selected = failed.routing.filter(e => e.kind === "lb-selected");
  expect(selected.filter(e => e.detail === "vm-5" && e.at > failed.removed! && e.at < failed.returned!)).toHaveLength(0);
  expect(selected.filter(e => e.detail === "vm-5" && e.at > failed.returned!).length).toBeGreaterThan(0);
  const shifted = (run: typeof normal) => run.routing.filter(e => e.kind === "lb-selected" && e.detail === "vm-1" && e.at > failed.removed! && e.at < failed.returned!).length;
  expect(shifted(failed)).toBeGreaterThan(shifted(normal));
  const during = failed.snapshots[8]![1]!, control = normal.snapshots[8]![1]!;
  console.info("six-vm-state", JSON.stringify({ removed: failed.removed, returned: failed.returned, selectedAtLimit: { normal: shifted(normal), failed: shifted(failed) }, limit: { control: control.rejected + control.queued, during: during.rejected + during.queued }, snapshots: [0, 8, 13].map(i => failed.snapshots[i]!.map(s => ({ id: s.id, rejected: s.rejected, queued: s.queued, completed: s.completed, throttled: s.compute!.cpu.throttledWallUs }))) }));
  expect(during.rejected + during.queued).toBeGreaterThan(control.rejected + control.queued);
  expect(failed.snapshots[8]!.slice(2, 5).some(s => s.rejected === 0 && s.queued === 0)).toBe(true);
  expect(failed.evidence.counts.offered).toBe(normal.evidence.counts.offered);
  const e = failed.evidence;
  expect(e.counts.offered).toBe(e.counts.completed + e.counts.rejected + e.counts.deadlineExceeded + e.counts.abandoned + e.counts.inFlight);
  expect(e.resultRetention.omitted).toBe(0); expect(selected).toHaveLength(e.network.loadBalancers[0]!.attempts);
  expect(hash(sixVmScenario(true).evidence)).toBe(hash(e));
});
