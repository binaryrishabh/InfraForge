import { expect, test } from "bun:test";
import { captureRunInputs, readRunInputs, engineSeed, assertSimulationContext, MODEL2_ENGINE_VERSION } from "../deployments/runInputs";
import { CATALOG_SNAPSHOT_DATE } from "@infraforge/catalog/types";
import { SIMULATION_MODEL_VERSION } from "@infraforge/simulation/tuning";
import { resolveWorkload } from "@infraforge/domain/workload";
import { createInitialState, tick } from "@infraforge/simulation/engine";
import { layout, seed, workload } from "./integration/scenario";

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
  expect(() => assertSimulationContext(v1)).not.toThrow();
  expect(() => assertSimulationContext({ ...v2, simulationModelVersion: "different-model" })).toThrow("differs");
  expect(() => assertSimulationContext({ ...v2, catalogSnapshot: "different-catalog" })).toThrow("differs");
});

test("resolved defaults preserve existing seeded engine outcomes", () => {
  expect(engineSeed(seed.text)).toBe(seed.engine);
  let implicit = createInitialState("run", layout.resources, layout.connectionLines, workload, seed.engine);
  let resolved = createInitialState("run", layout.resources, layout.connectionLines, resolveWorkload(workload), seed.engine);
  for (let i = 0; i < 120; i++) {
    implicit = tick(implicit, {}).state;
    resolved = tick(resolved, {}).state;
    expect(resolved.metrics).toEqual(implicit.metrics);
    expect(resolved.overallHealth).toBe(implicit.overallHealth);
  }
});
