import { requireKnown } from "../../reality/quantity";
import type { SavedProductDesign, ProductContract } from "./contracts";
import type { derivedLedger } from "./provenance";
import type { ArrivalSource, RateArrivals } from "../workload/contracts";
import { rateRows } from "../workload/arrivals";
export function compileArrivals(design: SavedProductDesign, contract: ProductContract, provenance: ReturnType<typeof derivedLedger>): ArrivalSource[] {
  const p = design.workload, app = contract.application!, horizon = requireKnown(contract.horizon, "us"), start = requireKnown(contract.arrival.start, "us");
  if (!Number.isFinite(p.targetThroughput) || p.targetThroughput <= 0 || !["per-minute", "per-hour"].includes(p.throughputUnit) || p.readWriteRatio === undefined || p.readWriteRatio < 0 || p.readWriteRatio > 1 || !["steady", "peak"].includes(p.trafficShape)) throw Error("Workload needs explicit positive throughput/unit, read fraction [0,1] and supported traffic shape");
  const baseInterval = (p.throughputUnit === "per-minute" ? 60000000 : 3600000000) / p.targetThroughput;
  if (baseInterval < 1 || start >= horizon) throw Error("Arrival rate/start outside bounded microsecond domain");
  if (!app.operations.some((o) => o.id === app.readOperation) || !app.operations.some((o) => o.id === app.writeOperation)) throw Error("Missing read/write operation mapping in application profile");
  const bytes = requireKnown(app.payloads[p.payloadSize], "bytes");
  // Payload metadata is carried by path byte contracts. Reject a semantic label mismatch.
  const entry = contract.transports[contract.caller.transport];
  for (const operation of [app.readOperation, app.writeOperation]) {
    const request = entry?.bytes[operation]?.request;
    if (!request || requireKnown(request, "bytes") !== bytes) throw Error("Payload label requires matching explicit entry request-byte profiles; dependency/protocol byte ownership is separate");
  }
  const peak = contract.arrival.peak;
  if (p.trafficShape === "peak" && (!peak || p.peakMultiplier === undefined || p.peakMultiplier < 1 || !Number.isFinite(p.peakMultiplier))) throw Error("Peak needs explicit window and multiplier; legacy shape has no timing information");
  if (peak && (requireKnown(peak.start, "us") < start || requireKnown(peak.end, "us") <= requireKnown(peak.start, "us") || requireKnown(peak.end, "us") > horizon)) throw Error("Invalid peak window");
  // A load change applies to arrivals scheduled at or after its time; earlier arrivals never change.
  const changes = (contract.arrival.changes ?? []).map((c) => ({ at: requireKnown(c.at, "us"), fraction: requireKnown(c.fraction, "ratio") }));
  if (changes.some((c, i) => !Number.isSafeInteger(c.at) || c.at < 0 || c.fraction < 0 || c.fraction > 10 || (i > 0 && c.at <= changes[i - 1]!.at))) throw Error("Load changes need increasing whole-microsecond times and fractions from 0 to 10");
  const provenanceText = "product-arrivals/1: deterministic open-loop spacing with fractional read accumulator, explicit peak window; not a user/session conversion or Poisson process";
  const rate: RateArrivals = { schema: "infraforge-rate-arrivals/1", provenance: provenanceText, startUs: start, endUs: horizon, intervalUs: baseInterval,
    readFraction: p.readWriteRatio, readOperation: app.readOperation, writeOperation: app.writeOperation,
    ...(p.trafficShape === "peak" ? { peak: { startUs: requireKnown(peak!.start, "us"), endUs: requireKnown(peak!.end, "us"), multiplier: p.peakMultiplier! } } : {}),
    changes: changes.map((c) => ({ atUs: c.at, fraction: c.fraction })) };
  // Live runs generate arrivals as they advance; other runs keep the stored trace. Both come from the same generator.
  const limit = contract.arrival.generated ? contract.limits.maxRequests : Math.min(contract.limits.maxRequests, contract.limits.maxTraceRows);
  const rows: Array<{ id: string; atUs: number; operation: string }> = [];
  let count = 0;
  for (const row of rateRows(rate)) {
    if (count++ >= limit) throw Error("Compiled arrival budget exceeded");
    if (!contract.arrival.generated) rows.push(row);
  }
  provenance.q("m2h.workload.baseInterval", baseInterval, "us", ["design.workload.targetThroughput", "design.workload.throughputUnit: dimensional conversion only"]);
  provenance.q("m2h.workload.readFraction", p.readWriteRatio, "ratio", ["design.workload.readWriteRatio", `application:${app.id}@${app.version}: explicit read/write operation meanings`], "user-input");
  if (contract.arrival.generated) return [{ id: "product-workload", kind: "rate", rate }];
  return [{ id: "product-workload", kind: "trace", trace: { schema: "infraforge-arrivals/1", unit: "us", durationUs: horizon, provenance: provenanceText, rows } }];
}
