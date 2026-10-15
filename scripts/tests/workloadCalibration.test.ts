import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fitConstantDemand, validateRecords } from "../../packages/simulation/src/model2/workload/calibration";
import { validateLedger } from "../../packages/simulation/src/reality/ledger";
import { candidateProfiles, calibrationReport, measuredInput } from "../reality/workload-calibration";
import { createWorkloadModel2 } from "../../packages/simulation/src/model2/workload/run";
import { workloadProofs } from "../reality/workload-proof";

const measurement = JSON.parse(readFileSync(new URL("../../docs/reality/m2b-measurements.json", import.meta.url), "utf8"));
const traces = () => JSON.parse(readFileSync(new URL("../../docs/reality/m2b-heldout-traces.json", import.meta.url), "utf8"));

test("measured calibration is reproducible, held-out and version/domain scoped", () => {
  const { fits, ledger } = candidateProfiles(measurement); expect(validateLedger(ledger)).toEqual([]);
  for (const fit of fits) {
    expect(fit.fit.batches).toBe(8); expect(fit.holdout.batches).toBe(4); expect(fit.profile.method).toBe("fitted"); expect(fit.profile.freeMode).toBe("forbidden");
    expect(fit.fittingRecordIds.some((id) => fit.heldOutRecordIds.includes(id))).toBe(false);
    expect(fit.profile.validity.exact.environment).toStartWith("local:");
  }
  const report = calibrationReport(measurement, traces());
  expect(report).toEqual(JSON.parse(readFileSync(new URL("../../docs/reality/m2b-calibration.json", import.meta.url), "utf8")));
  expect(report.experiments.length).toBe(12); expect(report.experiments.every((e) => e.fullDrain.modelCompleted === 80 && e.fullDrain.measuredCompleted === 80)).toBe(true);
});

test("holdout cannot influence a fitted demand; bad holdout exposes discrepancy", () => {
  const original = candidateProfiles(measurement), changed = structuredClone(measurement);
  for (const record of changed.records) if (record.split === "holdout") record.cpuCoreUs *= 10;
  const bad = candidateProfiles(changed);
  expect(bad.fits.map((f) => f.profile)).toEqual(original.fits.map((f) => f.profile));
  expect(bad.fits[0]!.holdout.meanAbsoluteRelativeError).toBeGreaterThan(0.8);
  const leakage = structuredClone(measurement.records); leakage.find((r: { split: string }) => r.split === "holdout").runId = leakage[0].runId;
  expect(() => validateRecords(leakage)).toThrow("leakage");
  const malformed = structuredClone(measurement.records); malformed[0].cpuCoreUs = 0;
  expect(() => validateRecords(malformed)).toThrow();
  const incomplete = measurement.records.filter((r: { split: string; operation: string }) => r.split === "fit" && r.operation === "light");
  const p = original.fits[0]!.profile;
  expect(() => fitConstantDemand(incomplete, p, "missing-holdout")).toThrow("held-out");
});

test("same measured RPS with different operation/mix demand changes pressure through work", () => {
  const report = calibrationReport(measurement, traces()), cases = report.experiments.filter((e) => e.factor === 1);
  const find = (name: string) => cases.find((e) => e.name === name)!;
  const light = find("light"), heavy = find("heavy"), mix90 = find("mix90"), mix50 = find("mix50");
  expect(light.offeredRps).toBe(heavy.offeredRps); expect(light.offeredRps).toBe(mix90.offeredRps); expect(light.offeredRps).toBe(mix50.offeredRps);
  expect(heavy.modelWindow.queued).toBeGreaterThan(light.modelWindow.queued); expect(heavy.modelWindow.completed).toBeLessThan(light.modelWindow.completed);
  expect(mix50.modelWindow.queued).toBeGreaterThan(mix90.modelWindow.queued); expect(mix50.latency.modelMeanUs).toBeGreaterThan(mix90.latency.modelMeanUs);
  expect(heavy.measuredWindow.completed).toBeLessThan(light.measuredWindow.completed);
  expect(mix50.latency.measuredMeanUs).toBeGreaterThan(mix90.latency.measuredMeanUs);
  const input = measuredInput(measurement, traces()[0].trace, 10000000, 100000);
  const service = input.resources[0]!; if (service.kind === "router") throw new Error(); service.context.labels.environment = "AWS-t3-medium";
  expect(() => createWorkloadModel2(input)).toThrow("Outside exact domain");
  const invalidLoad = measuredInput(measurement, traces()[0].trace, 10000000, 100000);
  const arrival = invalidLoad.arrivals[0]!; if (arrival.kind === "trace") arrival.trace.rows[1]!.atUs++;
  expect(() => createWorkloadModel2(invalidLoad)).toThrow("arrival-interval");
});

test("authored overload and fault proofs preserve caller and detached service accounting", () => {
  const proof = workloadProofs();
  expect(proof).toEqual(JSON.parse(readFileSync(new URL("../../docs/reality/m2b-proofs.json", import.meta.url), "utf8")));
  for (const p of proof) {
    const c = p.counts; expect(c.offered).toBe(c.completed + c.rejected + c.deadlineExceeded + c.abandoned + c.inFlight);
    expect(p.resources.every((s) => s.admitted === s.completed + s.failed + s.cancelled + s.queued + s.serving + s.waiting)).toBe(true);
  }
  const detached = proof.find((p) => p.name === "pause-detach")!;
  expect(detached.at500000Us!.counts.inFlight).toBe(0); expect(detached.at500000Us!.resources[0]!.queued).toBe(16);
  expect(detached.resources[0]!.completed).toBeGreaterThan(detached.counts.completed);
  const cancelled = proof.find((p) => p.name === "pause-cancel")!;
  expect(cancelled.resources[0]!.cancelled).toBe(cancelled.counts.cancellationConfirmedAtEntry);
});
