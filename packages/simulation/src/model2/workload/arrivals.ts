import type { ArrivalSource, ArrivalTrace, TraceRow } from "./contracts";
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
