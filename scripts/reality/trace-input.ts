import { createReadStream } from "node:fs";
import { ingestTrace } from "../../packages/simulation/src/model2/workload/arrivals";
import type { ArrivalTrace, TraceRow } from "../../packages/simulation/src/model2/workload/contracts";
import { TRACE_IMPORT_LIMITS as caps } from "../../packages/simulation/src/model2/workload/policy";

export interface TraceBudgets { maxRows: number; maxLineBytes: number; maxBytes: number }
// NDJSON: one versioned header, then authored arrival rows. All budgets are bytes/counts,
// not simulated performance values. Reject before allocating an oversized line/trace.
export async function parseTraceChunks(chunks: AsyncIterable<Uint8Array>, budgets: TraceBudgets, operations: Set<string>): Promise<ArrivalTrace> {
  if (!Object.values(budgets).every((n) => Number.isSafeInteger(n) && n > 0) || budgets.maxRows > caps.maxRows || budgets.maxLineBytes > caps.maxLineBytes || budgets.maxBytes > caps.maxBytes) throw new Error("Invalid trace import budgets");
  let pending = Buffer.alloc(0), bytes = 0, header: Omit<ArrivalTrace, "rows"> | undefined;
  const rows: TraceRow[] = [], decoder = new TextDecoder("utf-8", { fatal: true });
  const line = (data: Uint8Array) => {
    if (!data.length || data.length > budgets.maxLineBytes) throw new Error("Empty/oversized trace line");
    const value = JSON.parse(decoder.decode(data));
    if (!header) {
      if (!value || Object.keys(value).some((key) => !["schema", "unit", "durationUs", "provenance"].includes(key))) throw new Error("Invalid trace header schema");
      header = value;
    } else {
      if (rows.length >= budgets.maxRows) throw new Error("Trace row budget exceeded");
      rows.push(value);
    }
  };
  for await (const chunk of chunks) {
    bytes += chunk.byteLength; if (bytes > budgets.maxBytes) throw new Error("Trace byte budget exceeded");
    pending = Buffer.concat([pending, chunk]);
    let newline: number;
    while ((newline = pending.indexOf(10)) >= 0) { line(pending.subarray(0, newline)); pending = pending.subarray(newline + 1); }
    if (pending.length > budgets.maxLineBytes) throw new Error("Trace line byte budget exceeded");
  }
  if (pending.length) line(pending);
  if (!header) throw new Error("Missing trace header");
  return ingestTrace(header, rows, budgets.maxRows, operations);
}
export async function readArrivalTrace(path: string, budgets: TraceBudgets, operations: Set<string>) {
  return parseTraceChunks(createReadStream(path, { highWaterMark: caps.maxLineBytes }), budgets, operations);
}
