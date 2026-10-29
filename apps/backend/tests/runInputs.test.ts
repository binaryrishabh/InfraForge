import { expect, test } from "bun:test";
import { captureRunInputs, readRunInputs, assertSimulationContext, MODEL2_ENGINE_VERSION } from "../deployments/runInputs";
import { DEFAULT_RETRY_SETTINGS } from "@infraforge/domain/resource";
import { rerunInputHash } from "../reruns/options";
import { CATALOG_SNAPSHOT_DATE } from "@infraforge/catalog/types";
import { layout, workload } from "./integration/scenario";

test("capture detaches topology and resolves all workload defaults", () => {
  const design = structuredClone(layout);
  const input = captureRunInputs(design);
  design.resources[0]!.x = 999;
  expect<unknown>(input.resources).toEqual(layout.resources);
  expect(input.workloadProfile).toEqual({ targetThroughput: 1000000, throughputUnit: "per-hour",
    trafficShape: "steady", payloadSize: "medium", peakMultiplier: 3, readWriteRatio: 0.8 });
  expect(input.seed).not.toBe(captureRunInputs(layout).seed);
  expect(readRunInputs(input)).toEqual(input);
});

test("legacy, unknown versions and incomplete persisted inputs fail explicitly", () => {
  const valid = captureRunInputs(layout, workload);
  for (const input of [null, {}, { ...valid, version: 3 }, { ...valid, seed: "" },
    { ...valid, resources: undefined }, { ...valid, workloadProfile: workload }]) {
    expect(() => readRunInputs(input)).toThrow("cannot be reconstructed safely");
  }
});

test("V2 captures model/catalog provenance and V1 reads without invented metadata", () => {
  const v2 = captureRunInputs(layout, workload);
  expect(v2.version).toBe(2);
  expect(v2.simulationModelVersion).toBe(MODEL2_ENGINE_VERSION);
  expect(v2.catalogSnapshot).toBe(CATALOG_SNAPSHOT_DATE);
  const v1 = readRunInputs({ ...v2, version: 1 });
  expect(v1.version).toBe(1);
  expect(Object.hasOwn(v1, "simulationModelVersion")).toBe(false);
  expect(Object.hasOwn(v1, "catalogSnapshot")).toBe(false);
  // Version 1 inputs predate provenance: they were Model 1 runs, readable but never run again.
  expect(() => assertSimulationContext(v1)).toThrow("differs");
  expect(() => assertSimulationContext({ ...v2, simulationModelVersion: "1" })).toThrow("differs");
  expect(() => assertSimulationContext({ ...v2, simulationModelVersion: "different-model" })).toThrow("differs");
  expect(() => assertSimulationContext({ ...v2, catalogSnapshot: "different-catalog" })).toThrow("differs");
});

test("captures record current implicit profiles and old V1/V2 rows retain JSON and hash identity", () => {
  const design = structuredClone(layout);
  expect(captureRunInputs(design).adapterProfiles).toEqual([]);
  design.resources.find(r => r.type === "Load Balancer")!.retry = DEFAULT_RETRY_SETTINGS;
  const captured = captureRunInputs(design, workload, "profile-json");
  expect(captured.adapterProfiles).toEqual(["failure-cause/1"]);
  expect(readRunInputs(JSON.parse(JSON.stringify(captured)))).toEqual(captured);
  for (const version of [1, 2] as const) {
    const old = {...captured, version}; delete old.adapterProfiles;
    if (version === 1) { Reflect.deleteProperty(old, "simulationModelVersion"); Reflect.deleteProperty(old, "catalogSnapshot"); }
    const json = JSON.stringify(old), hash = rerunInputHash(old);
    const read = readRunInputs(JSON.parse(json));
    expect(read).not.toHaveProperty("adapterProfiles");
    expect(JSON.stringify(read)).toBe(json);
    expect(rerunInputHash(read)).toBe(hash);
  }
});

test("both run-input readers reject malformed or oversized profile lists", () => {
  const input = captureRunInputs(layout, workload, "profiles");
  for (const version of [1, 2]) for (const adapterProfiles of [null, "failure-cause/1", {}, [1], ["unknown/1"], ["failure-cause/1", "failure-cause/1"], Array(1000).fill("failure-cause/1")]) {
    expect(() => readRunInputs({...input, version, adapterProfiles})).toThrow("cannot be reconstructed safely");
  }
  for (const adapterProfiles of [[], ["failure-cause/1" as const]]) expect(readRunInputs({...input, adapterProfiles}).adapterProfiles).toEqual(adapterProfiles);
});
