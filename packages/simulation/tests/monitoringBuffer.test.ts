import { expect, test } from "bun:test";
import type { AdapterProfile } from "@infraforge/contracts/run-inputs";
import { bufferSetup } from "./monitoringBuffer.fixture";
import { monitoringDesign } from "./monitoringCadence.fixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";

const policy = { version: 2 as const, bufferSamples: 8, batchSamples: 4, exportAttempts: 3 };
test("buffer intent owns profile, authored quantities and composes with cadence", () => {
  for (const cadence of [false, true]) {
    const p = { ...policy, ...(cadence ? { collectionIntervalSeconds: 2, exportIntervalSeconds: 3 } : {}) }, f = bufferSetup("vm", p);
    const expectedProfiles: AdapterProfile[] = cadence ? ["monitor-cadence/1", "monitor-buffer/1"] : ["monitor-buffer/1"];
    expect(currentAdapterProfiles(f.saved.resources)).toEqual(expectedProfiles);
    expect(f.contract.nodes.monitor!.profileVersion).toContain("/monitor-buffer/1");
    expect(f.compiled.input.resources.find(r => r.kind === "monitor")).toMatchObject({ bufferSamples: { value: 8 }, batchSamples: { value: 4 }, attempts: { value: 3 }, bufferBytes: { value: 1048576 }, sampleBytes: { value: 128 } });
    for (const id of ["monitor.bufferSamples", "monitor.batch", "monitor.attempts"]) expect(f.contract.ledger.find(e => e.id === id)?.classification).toBe("user-input");
    for (const adapterProfiles of [[], ["monitor-buffer/1", "monitor-buffer/1"], ["monitor-cadence/1"]] as const) expect(contractFromDesign(f.saved, { adapterProfiles })).toHaveProperty("refused");
  }
  expect(contractFromDesign(monitoringDesign(), { adapterProfiles: ["monitor-buffer/1"] })).toHaveProperty("refused");
  expect(currentAdapterProfiles(bufferSetup("vm", { version: 2, bufferSamples: 1000, batchSamples: 100, exportAttempts: 2 }).saved.resources)).toEqual(["monitor-buffer/1"]);
});
test("compiler refuses missing, duplicate, mismatched global and owned buffer profiles", () => {
  for (const version of ["canvas-assumptions/2", "canvas-assumptions/2/monitor-buffer/1/monitor-buffer/1", "canvas-assumptions/2/monitor-buffer/2", "canvas-assumptions/2/monitor-buffer/10"]) for (const owned of [true, false]) {
    const f = bufferSetup("vm", policy); if (owned) f.contract.nodes.monitor!.profileVersion = version; else f.contract.version = version;
    expect(compileProduct(f.saved, f.contract).ok).toBe(false);
  }
});
test("compiler binds saved buffer, batch, attempts, cadence and fixed byte assumptions", () => {
  for (const field of ["bufferSamples", "batchSamples", "attempts", "sampleBytes", "bufferBytes", "interval", "exportInterval", "freshFor"] as const) {
    const f = bufferSetup("vm", policy), c = f.contract.nodes.monitor!.resources[0]!.config;
    if (c.kind !== "monitor") throw Error("Expected monitor");
    const quantity = c[field]; if (quantity.kind !== "known") throw Error("Expected known quantity");
    quantity.value++;
    const row = f.contract.ledger.find(e => e.id === quantity.provenance[0])!; row.quantity = quantity; row.formula = String(quantity.value);
    const result = compileProduct(f.saved, f.contract); expect(result.ok).toBe(false);
    if (!result.ok) expect(JSON.stringify(result.diagnostics)).toContain("must match saved intent");
  }
});
