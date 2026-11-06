import { expect, test } from "bun:test";
import { interventionError } from "@infraforge/domain/resource";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { withRunLength } from "../src/model2/product/runContract";
import { withTimeline, type TimedAction } from "../src/model2/product/timeline";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import type { SavedProductDesign } from "../src/model2/product/contracts";

const crash = (id = "fail", atUs = 1_000_001, duration = 2, resourceId = "app"): TimedAction => ({id, atUs, kind: "intervention",
  request: {interventionId: "vm-crash", revision: 1, target: {resourceId}, parameters: {duration}}});
function fixture() {
  const design: SavedProductDesign = {schema: "infraforge-saved-design/1", resources: [
    {id: "app", type: "Virtual Machine", x: 0, y: 0, skuId: "c5.large"}, {id: "db", type: "Database", x: 256, y: 0, size: "medium"}],
    connections: [{id: "app-db", sourceId: "app", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432}],
    workload: {targetThroughput: 12000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"}};
  const built = contractFromDesign(design); if ("refused" in built) throw Error(JSON.stringify(built));
  const base = withRunLength(built.contract, 6, "vm-crash-proof");
  const compile = (actions: TimedAction[]) => compileProduct(design, withTimeline(base, actions));
  return {design, compile};
}

test("scripted VM crash aborts owned calls, refuses work, and restores readiness at the exact end", () => {
  const {compile} = fixture(), a = compile([crash()]), b = compile([]), legacy = compile([{id: "fail", kind: "crash", node: "app", atUs: 1_000_001, durationUs: 1_000_000, restartUs: 1_000_000}]);
  if (!a.ok || !b.ok || !legacy.ok) throw Error(JSON.stringify([a,b,legacy]));
  const events: Array<{kind: string; resource: string; atUs: number}> = [];
  const run = createProductModel2(a.value, undefined, e => events.push(e)), control = createProductModel2(b.value);
  const legacyRun = createProductModel2(legacy.value);
  expect(a.value.interventionReceipts).toMatchObject([{resolvedTargets: ["app"], atUs: 1_000_001, endUs: 3_000_001}]);
  run.advanceTo(1_000_000); control.advanceTo(1_000_000);
  expect(run.evidence().counts).toEqual(control.evidence().counts); expect(run.up("app")).toBe(true);
  run.advanceTo(1_000_001); expect(run.up("app")).toBe(false);
  expect(events.some(e => e.kind === "process-crash" && e.resource === "app" && e.atUs === 1_000_001)).toBe(true);
  run.advanceTo(2_000_001); expect(run.up("app")).toBe(false); // Process restart still holds readiness false.
  run.advanceTo(3_000_000); expect(run.activeInterventions()).toHaveLength(1); expect(run.up("app")).toBe(false);
  run.advanceTo(3_000_001); expect(run.up("app")).toBe(true); expect(run.activeInterventions()).toEqual([]);
  expect(events.some(e => e.kind === "process-ready" && e.atUs === 3_000_001)).toBe(true);
  run.advanceTo(6_000_000); control.advanceTo(6_000_000);
  legacyRun.advanceTo(6_000_000); expect(run.evidence().counts).toEqual(legacyRun.evidence().counts);
  expect(run.evidence().resources).toEqual(legacyRun.evidence().resources);
  expect(run.evidence().counts.rejected).toBeGreaterThan(control.evidence().counts.rejected);
  expect(run.evidence().counts.completed).toBeLessThan(control.evidence().counts.completed);
  expect(a.value.input.resources).toEqual(b.value.input.resources);
});

test("VM crash refuses unsupported roles, bounds, overlapping windows and replacement ambiguity", () => {
  const {compile} = fixture();
  for (const resourceId of ["db", "missing"]) expect(compile([crash("bad", 1, 2, resourceId)]).ok).toBe(false);
  for (const duration of [0, 1, 1.5, 301]) {
    const action = crash("bad", 1, duration);
    if (action.kind !== "intervention") throw Error("fixture");
    expect(interventionError(action.request)).not.toBeNull();
  }
  expect(compile([crash("a"), crash("b", 2_000_001)]).ok).toBe(false);
  expect(compile([crash("a"), crash("b", 3_000_001)]).ok).toBe(true);
  expect(compile([{id: "old", kind: "crash", node: "app", atUs: 1_000_000, durationUs: 1_000_000, restartUs: 1_000_000}, crash()]).ok).toBe(false);
  expect(compile([crash("late", 5_000_001)]).ok).toBe(false);
});
