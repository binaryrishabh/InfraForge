import { requireKnown } from "../../reality/quantity";
import type { SavedProductDesign, ProductContract } from "./contracts";
import type { derivedLedger } from "./provenance";
import type { ArrivalSource } from "../workload/contracts";
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
  const fraction = (time: number) => { let f = 1; for (const c of changes) if (c.at <= time) f = c.fraction; else break; return f; };
  let at = start, index = 0, readDebt = 0;
  const rows: Array<{ id: string; atUs: number; operation: string }> = [];
  while (Math.round(at) < horizon) {
    if (fraction(at) === 0) { const next = changes.find((c) => c.at > at); if (!next) break; at = next.at; continue; }
    if (rows.length >= contract.limits.maxRequests || rows.length >= contract.limits.maxTraceRows) throw Error("Compiled arrival budget exceeded");
    readDebt += p.readWriteRatio; const read = readDebt >= 1; if (read) readDebt -= 1;
    rows.push({ id: `arrival-${index++}`, atUs: Math.round(at), operation: read ? app.readOperation : app.writeOperation });
    const inPeak = p.trafficShape === "peak" && at >= requireKnown(peak!.start, "us") && at < requireKnown(peak!.end, "us");
    const gap = baseInterval / ((inPeak ? p.peakMultiplier! : 1) * fraction(at)); if (gap < 1) throw Error("Peak exceeds microsecond resolution"); at += gap;
  }
  provenance.q("m2h.workload.baseInterval", baseInterval, "us", ["design.workload.targetThroughput", "design.workload.throughputUnit: dimensional conversion only"]);
  provenance.q("m2h.workload.readFraction", p.readWriteRatio, "ratio", ["design.workload.readWriteRatio", `application:${app.id}@${app.version}: explicit read/write operation meanings`], "user-input");
  return [{ id: "product-workload", kind: "trace", trace: { schema: "infraforge-arrivals/1", unit: "us", durationUs: horizon, provenance: "product-arrivals/1: deterministic open-loop spacing with fractional read accumulator, explicit peak window; not a user/session conversion or Poisson process", rows } }];
}
