import { readProofText } from "../reality/frozen-artifacts";
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { asyncCalibration, readAsyncMeasurements } from "../reality/async-calibration";
import { asyncProofs } from "../reality/async-proofs";
import { validateLedger } from "../../packages/simulation/src/reality/ledger";
test("M2F fit/holdout artifacts preserve rejected timing, semantic identity and logical bytes", () => {
  const report = asyncCalibration(readAsyncMeasurements()); expect(report).toEqual(JSON.parse(readFileSync(new URL("../../docs/reality/m2f-calibration.json", import.meta.url), "utf8"))); expect(report.results).toHaveLength(54); expect(report.objectResults).toHaveLength(108); expect(report.candidates).toHaveLength(8); expect(report.acceptance).toContain("REJECTED"); expect(report.objectCpuZeroSamples).toBeGreaterThan(0); expect(validateLedger([...report.ledger, ...report.policyLedger])).toEqual([]);
});
test("held-out measurements cannot alter M2F candidates; split, source and byte drift fail closed", () => {
  const input = readAsyncMeasurements(), baseline = asyncCalibration(input), bad = structuredClone(input);
  for (const row of bad.broker.filter((r) => r.split === "holdout")) { row.wallUs *= 4; row.throughput /= 4; row.results.forEach((r) => r.responseUs *= 4); }
  const changed = asyncCalibration(bad); expect(changed.candidates).toEqual(baseline.candidates); expect(changed.summaries).not.toEqual(baseline.summaries);
  const split = structuredClone(input); split.broker[0]!.split = "holdout"; expect(() => asyncCalibration(split)).toThrow("split"); const source = structuredClone(input); source.sourceHash = "changed"; expect(() => asyncCalibration(source)).toThrow("source"); const bytes = structuredClone(input); bytes.objects[0]!.storedBytes++; expect(() => asyncCalibration(bytes)).toThrow("object");
});
test("M2F proof artifacts replay real backlog, poison attempts, duplicates and failed-confirm ambiguity", () => {
  const p = asyncProofs(); expect(p).toEqual(JSON.parse(readProofText(new URL("../../docs/reality/m2f-proofs.json", import.meta.url)))); expect(p.failureWindow.asynchronous.workers[0]!.effects).toBe(2); expect(p.duplicate.asynchronous.workers[0]!.effects).toBeGreaterThan(p.idempotent.asynchronous.workers[0]!.effects); expect(p.publisherRetry.asynchronous.brokers[0]!.accepted).toBe(2); expect(p.publisherDedup.asynchronous.brokers[0]!.accepted).toBe(1);
});
