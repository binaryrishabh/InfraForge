import type { FirstStackReportCapture, ReportJson } from "@infraforge/contracts/reports";
import { boundedJson } from "./bounds";
import type { createFirstStackRuntime } from "./run";

type Runtime = ReturnType<typeof createFirstStackRuntime>;
// One pure capture implementation for the server and browser worker. Aggregate
// reducers remain authoritative when this bounded selection is incomplete.
export function captureReport(runtime: Runtime, e: ReturnType<Runtime["evidence"]>): FirstStackReportCapture {
  const journal = runtime.journal.measure();
  const { events, ...selection } = runtime.journal.selection();
  const data = { databases: e.data.databases.map(({ rows: _rows, active: _active, waiters: _waiters, ...metrics }) => metrics),
    caches: e.data.caches.map(({ entries: _entries, ...metrics }) => metrics),
    applications: e.data.applications.map(({ results: _results, ...metrics }) => metrics) };
  const { trace, policyLedger: _policyLedger, ...network } = e.network;
  const throughUs = e.capture.throughUs;
  const value: FirstStackReportCapture = {
    schema: "first-stack-report-capture/1",
    saturation: { cpu: e.composition.cpu as unknown as ReportJson, resources: e.resources as unknown as ReportJson,
      sampledAtUs: e.at, network: { ...network, trace: { totals: trace.totals, omitted: trace.omitted } } as unknown as ReportJson, data: data as unknown as ReportJson,
      storage: (e.composition.storage ?? null) as unknown as ReportJson },
    events, selection: { ...selection, policy: "first-3-roots-and-global/1" }, unknown: [],
    // The first-stack composition materializes fixed hosts at time zero. Process
    // faults do not deallocate hosts. This is occupancy through a cut, never a
    // provider binding or a claim that the allocation terminates at the horizon.
    allocationUsage: { schema: "first-stack-allocation-usage/1", basis: "modeled-fixed-host-window/1", fromUs: 0, throughUs,
      timestampComplete: e.capture.timestampComplete ?? true,
      allocations: (e.composition.hosts as Array<{ id: string }>).map(h => ({ id: h.id, host: h.id, fromUs: 0, toUs: throughUs, instanceUs: throughUs })) },
  };
  try { boundedJson(value, 256 * 1024); return value; }
  catch { return { ...value, saturation: { cpu: null, resources: null, sampledAtUs: null, network: null, data: null, storage: null }, events: [],
    selection: { ...value.selection, omitted: journal.retained }, unknown: ["Diagnostic capture exceeded its byte budget; saturation and selected causes are Unknown"] }; }
}
