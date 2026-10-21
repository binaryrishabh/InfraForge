import type { FirstStackReportCapture, ReportJson } from "@infraforge/contracts/reports";
import { boundedJson } from "@infraforge/simulation/internal-first-stack";
import type { instantiatePreparedFirstStack } from "./execution";

type Runtime = ReturnType<typeof instantiatePreparedFirstStack>;
// Aggregate reducers remain authoritative when this bounded selection is incomplete.
export function captureReport(runtime: Runtime, e: ReturnType<Runtime["evidence"]>): FirstStackReportCapture {
  const journal = runtime.journal.measure();
  const { events, ...selection } = runtime.journal.selection();
  // Keep cumulative metrics without copying keyed state or raw per-call rows
  // into every durable frame. Their absence never removes reducer counts.
  const data = { databases: e.data.databases.map(({ rows: _rows, active: _active, waiters: _waiters, ...metrics }) => metrics),
    caches: e.data.caches.map(({ entries: _entries, ...metrics }) => metrics),
    applications: e.data.applications.map(({ results: _results, ...metrics }) => metrics) };
  const { trace, policyLedger: _policyLedger, ...network } = e.network;
  const value: FirstStackReportCapture = {
    schema: "first-stack-report-capture/1",
    saturation: { cpu: e.composition.cpu as unknown as ReportJson, resources: e.resources as unknown as ReportJson,
      sampledAtUs: e.at, network: { ...network, trace: { totals: trace.totals, omitted: trace.omitted } } as unknown as ReportJson, data: data as unknown as ReportJson,
      storage: (e.composition.storage ?? null) as unknown as ReportJson },
    events, selection: { ...selection, policy: "first-3-roots-and-global/1" }, unknown: [],
  };
  try { boundedJson(value, 256 * 1024); return value; }
  catch { return { ...value, saturation: { cpu: null, resources: null, sampledAtUs: null, network: null, data: null, storage: null }, events: [],
    selection: { ...value.selection, omitted: journal.retained }, unknown: ["Diagnostic capture exceeded its byte budget; saturation and selected causes are Unknown"] }; }
}
