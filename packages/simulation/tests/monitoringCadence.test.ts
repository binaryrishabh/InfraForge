import { expect, test } from "bun:test";
import { monitoringDesign, monitoringSetup } from "./monitoringCadence.fixture";
import { prepare } from "./asyncCanvas.fixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";

test("explicit numeric cadence owns its profile and materialized timings, keeping freshness", () => {
  for (const seconds of [1, 10, 60]) {
    const f = monitoringSetup("vm", { version: 1, collectionIntervalSeconds: seconds, exportIntervalSeconds: seconds });
    expect(currentAdapterProfiles(f.saved.resources)).toEqual(["monitor-cadence/1"]);
    expect(f.compiled.input.resources.find(r => r.kind === "monitor")).toMatchObject({ interval: { value: seconds * 1000000 }, exportInterval: { value: seconds * 1000000 }, freshFor: { value: 30000000 } });
    expect(f.contract.nodes.monitor!.profileVersion).toContain("/monitor-cadence/1");
    expect(f.contract.ledger.find(e => e.id === "monitor.interval")?.classification).toBe("user-input");
  }
  const empty = monitoringDesign("vm", { version: 1 });
  expect(currentAdapterProfiles(empty.resources)).toEqual([]);
  expect(contractFromDesign(empty, { adapterProfiles: [] })).not.toHaveProperty("refused");
});

test("missing, duplicate, mismatched and unsupported cadence profiles refuse", () => {
  const design = monitoringDesign("vm", { version: 1, collectionIntervalSeconds: 2 });
  for (const adapterProfiles of [[], ["monitor-cadence/1", "monitor-cadence/1"], ["cdn-ttl/1"]] as const) expect(contractFromDesign(design, { adapterProfiles })).toHaveProperty("refused");
  expect(contractFromDesign(monitoringDesign(), { adapterProfiles: ["monitor-cadence/1"] })).toHaveProperty("refused");
  for (const version of ["canvas-assumptions/2", "canvas-assumptions/2/monitor-cadence/1/monitor-cadence/1", "canvas-assumptions/2/monitor-cadence/2", "canvas-assumptions/2/monitor-cadence/10"]) for (const owned of [true, false]) {
    const f = prepare(design); if (owned) f.contract.nodes.monitor!.profileVersion = version; else f.contract.version = version;
    expect(compileProduct(design, f.contract).ok).toBe(false);
  }
});

test("compiler refuses materialized cadence and freshness that contradict saved intent", () => {
  for (const field of ["interval", "exportInterval", "freshFor"] as const) {
    const f = monitoringSetup("vm", { version: 1, collectionIntervalSeconds: 2, exportIntervalSeconds: 3 });
    const c = f.contract.nodes.monitor!.resources[0]!.config; if (c.kind !== "monitor" || c[field].kind !== "known") throw Error("Expected monitor");
    c[field] = { ...c[field], value: 4000000 };
    const row = f.contract.ledger.find(e => e.id === c[field].provenance[0])!; row.quantity = c[field]; row.formula = "4000000";
    const result = compileProduct(f.saved, f.contract); expect(result.ok).toBe(false);
    if (!result.ok) expect(JSON.stringify(result.diagnostics)).toContain("must match saved intent");
  }
});
