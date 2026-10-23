import { readProofText } from "../reality/frozen-artifacts";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadSystemsMeasurements, replaySystemsMeasurements } from "../reality/systems-calibration";
import { systemsProofs } from "../reality/systems-proofs";
test("M2G local observations replay byte/ownership semantics without a timing fit", () => {
  const result = replaySystemsMeasurements(loadSystemsMeasurements()); expect(result).toEqual(JSON.parse(readFileSync(new URL("../../docs/reality/m2g-calibration.json", import.meta.url), "utf8"))); expect(result.fit.attempted).toBe(false); expect(Object.values(result.predictors).every((v) => v === "Unknown")).toBe(true); expect(result.cdn).toHaveLength(6); expect(result.registry.bytes).toBe(69760);
});
test("timing corruption cannot create a fitted predictor; semantic/source/cleanup drift is refused", () => {
  const original = loadSystemsMeasurements(), changed = structuredClone(original); changed.tls.compatible.durationMs *= 100; changed.tls.untrusted.durationMs = 0; expect(replaySystemsMeasurements(changed)).toEqual(replaySystemsMeasurements(original));
  const source = structuredClone(original); source.sourceHash = "wrong"; expect(() => replaySystemsMeasurements(source)).toThrow("source"); const bytes = structuredClone(original); bytes.cdn[0]!.coldBodies[0]!.bytes++; expect(() => replaySystemsMeasurements(bytes)).toThrow("bytes"); const cleanup = structuredClone(original); cleanup.cleanup.complete = false; expect(() => replaySystemsMeasurements(cleanup)).toThrow("cleanup");
});
test("M2G cross-resource proofs replay actual state, failures, gaps and recovery", () => {
  const result = systemsProofs(); expect(result).toEqual(JSON.parse(readProofText(new URL("../../docs/reality/m2g-proofs.json", import.meta.url)))); expect(result.dnsPooled!.counts.completed).toBe(6); expect(result.dnsFresh!.counts.completed).toBe(2); expect(result.registryRecovered!.systems.clients[0]!.replicas.every((r) => r.state === "running")).toBe(true); expect(result.cacheDenied!.database[0]!.logicalReads).toBeGreaterThan(result.cacheNormal!.database[0]!.logicalReads);
});
