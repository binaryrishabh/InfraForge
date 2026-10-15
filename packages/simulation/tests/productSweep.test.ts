import { expect, test } from "bun:test";
import { generatedCompilerCases, generatedControllerCases } from "./productCases";
test("2048 generated domain compiler cases preserve order independence/provenance and refuse incomplete physics", () => {
  const result = generatedCompilerCases(); expect(result.count).toBe(2048); expect(result.valid).toBe(1536); expect(result.refused).toBe(512); console.info(`M2H_SWEEP_COMPILER ${JSON.stringify(result)}`);
}, 240000);
test("2048 generated real controller compositions conserve state across startup, stale data, faults and drain", () => {
  const result = generatedControllerCases(); expect(result.count).toBe(2048); expect(result.replays).toBe(16); expect(result.created).toBeGreaterThan(2048); expect(result.missing).toBeGreaterThan(0); expect(result.artifactFailures).toBeGreaterThan(0); console.info(`M2H_SWEEP_CONTROLLERS ${JSON.stringify(result)}`);
}, 600000);
