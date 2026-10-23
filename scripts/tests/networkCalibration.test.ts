import { readProofText } from "../reality/frozen-artifacts";
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { networkCalibration, readNetworkMeasurements } from "../reality/network-calibration";
import { networkProofs } from "../reality/network-proofs";
import { validateLedger } from "../../packages/simulation/src/reality/ledger";

test("network campaign replays exact bytes, disjoint fit points and visible held-out residuals", () => {
  const data = readNetworkMeasurements(), report = networkCalibration(data);
  expect(report).toEqual(JSON.parse(readFileSync(new URL("../../docs/reality/m2d-calibration.json", import.meta.url), "utf8")));
  expect(report.results).toHaveLength(90); expect(report.candidates).toHaveLength(16); expect(validateLedger([...report.ledger, ...report.policyLedger])).toEqual([]);
  expect(report.candidates.every((c) => c.validity.payload !== 4096 && c.validity.pool !== 2 && c.validity.concurrency === 8 && c.freeMode === "forbidden")).toBe(true);
  expect(report.summaries.find((s) => s.split === "holdout")!.throughputMARE).toBeGreaterThan(1);
});
test("holdout corruption changes errors but cannot fit away poor network predictions", () => {
  const data = readNetworkMeasurements(), baseline = networkCalibration(data), bad = structuredClone(data);
  bad.records.filter((r) => r.split === "holdout").forEach((r) => { r.throughput /= 10; r.results.forEach((x) => x.responseUs *= 10); });
  const changed = networkCalibration(bad); expect(changed.candidates).toEqual(baseline.candidates); expect(changed.summaries[1]!.throughputMARE).toBeGreaterThan(baseline.summaries[1]!.throughputMARE);
});
test("network proof artifacts replay reuse, graceful/forced drain and real retry work", () => {
  const proofs = networkProofs(); expect(proofs).toEqual(JSON.parse(readProofText(new URL("../../docs/reality/m2d-proofs.json", import.meta.url))));
  expect(proofs.reuse!.network.paths[0]!.pool.created).toBe(1); expect(proofs.fresh!.network.paths[0]!.pool.created).toBe(8);
  expect(proofs.graceful!.counts.completed).toBeGreaterThan(proofs.forced!.counts.completed);
  expect(proofs.storm!.network.loadBalancers[0]!.attempts).toBeGreaterThan(proofs.noRetry!.network.loadBalancers[0]!.attempts);
  const bytes = (key: string) => proofs[key]!.network.links.reduce((n, l) => n + l.transmittedBytes, 0);
  expect(bytes("storm")).toBeGreaterThan(bytes("noRetry"));
});
