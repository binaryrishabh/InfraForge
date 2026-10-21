import type { FirstStackReportCapture, ReportJson } from "@infraforge/contracts/reports";
import { boundedJson } from "@infraforge/simulation/internal-first-stack";
import type { createFirstStackRuntime } from "@infraforge/simulation/internal-first-stack";

type Runtime = ReturnType<typeof createFirstStackRuntime>;
const without = (value: object, keys: string[]) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

// Browser counterpart of the server's bounded durable-cut capture. The server
// oracle independently checks the complete payload, including overflow fallback.
export function captureBrowserReport(runtime: Runtime, e: ReturnType<Runtime["evidence"]>): FirstStackReportCapture {
  const journal = runtime.journal.measure(), { events, ...selection } = runtime.journal.selection();
  const data = { databases: e.data.databases.map(value => without(value, ["rows", "active", "waiters"])),
    caches: e.data.caches.map(value => without(value, ["entries"])),
    applications: e.data.applications.map(value => without(value, ["results"])) };
  const network = without(e.network, ["trace", "policyLedger"]), trace = e.network.trace;
  const value: FirstStackReportCapture = { schema: "first-stack-report-capture/1",
    saturation: { cpu: e.composition.cpu as unknown as ReportJson, resources: e.resources as unknown as ReportJson,
      sampledAtUs: e.at, network: { ...network, trace: { totals: trace.totals, omitted: trace.omitted } } as unknown as ReportJson,
      data: data as unknown as ReportJson, storage: (e.composition.storage ?? null) as unknown as ReportJson },
    events, selection: { ...selection, policy: "first-3-roots-and-global/1" }, unknown: [] };
  try { boundedJson(value, 256 * 1024); return value; }
  catch { return { ...value, saturation: { cpu: null, resources: null, sampledAtUs: null, network: null, data: null, storage: null }, events: [],
    selection: { ...value.selection, omitted: journal.retained }, unknown: ["Diagnostic capture exceeded its byte budget; saturation and selected causes are Unknown"] }; }
}
