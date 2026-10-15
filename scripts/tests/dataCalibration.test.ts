import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { dataCalibration, readDataMeasurements } from "../reality/data-calibration";
import { dataProofs } from "../reality/data-proofs";
import { validateLedger } from "../../packages/simulation/src/reality/ledger";
test("M2E measurements replay disjoint CPU candidates, rejected timing and exact logical cache sequences", () => {
  const r = dataCalibration(readDataMeasurements()); expect(r).toEqual(JSON.parse(readFileSync(new URL("../../docs/reality/m2e-calibration.json", import.meta.url), "utf8"))); expect(r.results).toHaveLength(60); expect(r.cacheResults).toHaveLength(54); expect(r.candidates).toHaveLength(10); expect(r.acceptance).toContain("REJECTED"); expect(validateLedger([...r.ledger, ...r.policyLedger])).toEqual([]);
});
test("held-out latency corruption cannot change fitted M2E demand; split/source drift is refused", () => {
  const input = readDataMeasurements(), original = dataCalibration(input), bad = structuredClone(input); for (const row of bad.database.filter((r) => r.split === "holdout")) { row.wallUs *= 10; row.throughput /= 10; row.results.forEach((v) => v.responseUs *= 10); }
  const changed = dataCalibration(bad); expect(changed.candidates).toEqual(original.candidates); expect(changed.summaries).not.toEqual(original.summaries); bad.database[0]!.split = "holdout"; expect(() => dataCalibration(bad)).toThrow("split");
});
test("M2E proof artifacts replay cascades, contention, exhaustion and detached remote work", () => {
  const p = dataProofs(); expect(p).toEqual(JSON.parse(readFileSync(new URL("../../docs/reality/m2e-proofs.json", import.meta.url), "utf8"))); expect(p.conflicting.peakWaiting).toBeGreaterThan(p.independent.peakWaiting); expect(p.cacheFailure.data.applications[0]!.databaseFetches).toBeGreaterThan(p.normal.data.applications[0]!.databaseFetches); expect(p.detached.counts.deadlineExceeded).toBeGreaterThan(0);
});
