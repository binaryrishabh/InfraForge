import type { ArrivalSource, ArrivalTrace, RateArrivals, TraceRow } from "./contracts";
import { requireKnown } from "../../reality/quantity";
import { keyedUniform } from "../random";
import { micros } from "../time";
import { WORKLOAD_LIMITS } from "./policy";

export const identity = (...parts: Array<string | number>) => JSON.stringify(parts);

// Bounded ingestion consumes at most limit+1 rows, including an infinite iterable.
// File/line byte limits belong to the I/O adapter; this module has no filesystem.
export function ingestTrace(header: Omit<ArrivalTrace, "rows">, rows: Iterable<TraceRow>, limit: number, operations: Set<string>): ArrivalTrace {
  if (!Number.isSafeInteger(limit) || limit < 0 || header.schema !== "infraforge-arrivals/1" || header.unit !== "us" || !header.provenance) throw new Error("Invalid trace schema/budget/provenance");
  micros(header.durationUs);
  const accepted: TraceRow[] = [], ids = new Set<string>();
  let previous = -1;
  for (const row of rows) {
    if (accepted.length >= limit) throw new Error("Trace row budget exceeded");
    if (!row || Object.keys(row).some((key) => !["id", "atUs", "operation", "payloadBytes"].includes(key))) throw new Error("Invalid trace row schema");
    micros(row.atUs);
    if (row.atUs < previous || row.atUs > header.durationUs || typeof row.id !== "string" || typeof row.operation !== "string" || !row.id || row.id.length > WORKLOAD_LIMITS.identityCharacters || ids.has(row.id) || !operations.has(row.operation)) throw new Error("Invalid trace order/duration/identity/operation");
    if (row.payloadBytes !== undefined && (!Number.isSafeInteger(row.payloadBytes) || row.payloadBytes < 0)) throw new Error("Invalid trace payload bytes");
    accepted.push({ ...row }); ids.add(row.id); previous = row.atUs;
  }
  // Canonicalize ties by authored identity, never by input array position.
  accepted.sort((a, b) => a.atUs - b.atUs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { ...header, rows: accepted };
}

export function* openRows(source: Exclude<ArrivalSource, { kind: "closed" }>, seed: string): Generator<TraceRow> {
  if (source.kind === "trace") { yield* source.trace.rows; return; }
  if (source.kind === "rate") { yield* rateRows(source.rate); return; }
  const count = requireKnown(source.count, "count");
  let at = requireKnown(source.start, "us");
  for (let index = 0; index < count; index++) {
    // The initial Poisson arrival also has an exponential gap after start.
    if (source.kind === "poisson") {
      const u = keyedUniform(seed, source.id, identity(index), "arrival-gap");
      at += Math.max(1, Math.ceil(-Math.log1p(-u) * requireKnown(source.meanInterval, "us")));
    } else if (index) at += requireKnown(source.interval, "us");
    micros(at);
    yield { id: identity(source.id, index), atUs: at, operation: source.operation };
  }
}

// Deterministic open-loop spacing with a fractional read accumulator. A load change applies to arrivals scheduled
// at or after its time; at load 0 the next arrival waits for the next change.
export function* rateRows(r: RateArrivals): Generator<TraceRow> {
  const fraction = (time: number) => { let f = 1; for (const c of r.changes) if (c.atUs <= time) f = c.fraction; else break; return f; };
  let at = r.startUs, index = 0, readDebt = 0;
  while (Math.round(at) < r.endUs) {
    if (fraction(at) === 0) { const next = r.changes.find((c) => c.atUs > at); if (!next) return; at = next.atUs; continue; }
    readDebt += r.readFraction; const read = readDebt >= 1; if (read) readDebt -= 1;
    yield { id: `arrival-${index++}`, atUs: Math.round(at), operation: read ? r.readOperation : r.writeOperation };
    const inPeak = r.peak !== undefined && at >= r.peak.startUs && (r.peak.everyUs === undefined ? at < r.peak.endUs : (at - r.peak.startUs) % r.peak.everyUs < r.peak.endUs - r.peak.startUs);
    const gap = r.intervalUs / ((inPeak ? r.peak!.multiplier : 1) * fraction(at)); if (gap < 1) throw Error("Peak exceeds microsecond resolution"); at += gap;
  }
}

export function validateRate(r: RateArrivals, operations: Set<string>): string[] {
  const finite = [r.startUs, r.endUs, r.intervalUs, r.readFraction, ...(r.peak ? [r.peak.startUs, r.peak.endUs, r.peak.multiplier, r.peak.everyUs ?? 1] : []), ...r.changes.flatMap((c) => [c.atUs, c.fraction])];
  if (r.schema !== "infraforge-rate-arrivals/1" || !r.provenance || finite.some((n) => !Number.isFinite(n))) return ["Invalid rate arrival schema/provenance"];
  const errors: string[] = [];
  if (r.startUs < 0 || r.endUs <= r.startUs || r.intervalUs < 1 || r.readFraction < 0 || r.readFraction > 1) errors.push("Invalid rate arrival window/interval/read fraction");
  if (!operations.has(r.readOperation) || !operations.has(r.writeOperation)) errors.push("Unknown rate arrival operation");
  // A repeating window may begin after the run ends (then it never applies); a single window must fit the run.
  if (r.peak && (r.peak.startUs < r.startUs || r.peak.endUs <= r.peak.startUs || r.peak.multiplier < 1 ||
    (r.peak.everyUs === undefined ? r.peak.endUs > r.endUs : r.peak.everyUs <= r.peak.endUs - r.peak.startUs))) errors.push("Invalid rate arrival peak window");
  if (r.changes.some((c, i) => !Number.isSafeInteger(c.atUs) || c.atUs < 0 || c.fraction < 0 || c.fraction > 10 || (i > 0 && c.atUs <= r.changes[i - 1]!.atUs))) errors.push("Invalid rate arrival load changes");
  return errors;
}

