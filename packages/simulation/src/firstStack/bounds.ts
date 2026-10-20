import { utf8Bytes } from "../model2/time";
import type { FirstStackDiagnostic, FirstStackSidecarV2, ResolvedSchedule } from "@infraforge/contracts/first-stack";
// Refusals live below admission so the compiler has no reverse dependency.

const MiB = 1024 * 1024;
// Qualification ceilings only. Host isolation/readiness belongs to slice 10b.
export const FIRST_STACK_ENVELOPE = Object.freeze({ revision: "first-stack-envelope/1",
  horizonUs: 300_000_000, roots: 20_000, events: 2_000_000, pendingEvents: 50_000, liveCalls: 10_000,
  operations: 32, keys: 10_000, dictionaryBytes: MiB, semanticBytes: 16 * MiB,
  queueEntries: 10_000, retainedSamples: 128, sampleBytes: 2 * MiB, rawBytes: MiB,
  journalBytes: 16 * MiB, summaryBytes: 10 * MiB, captureBytes: 32 * MiB, frameBytes: MiB,
  sliceEvents: 128, sliceWallMs: 25, cpuUs: 30_000_000, wallMs: 60_000,
  rssTargetBytes: 512 * MiB, rssHardBytes: 768 * MiB,
});

// Incremental JSON encoding: stop before retaining an expanded object/string.
// Only finite JSON data is accepted; no custom serializers or evaluators.
export function boundedJson(value: unknown, limit: number): string {
  if (!Number.isSafeInteger(limit) || limit < 0) throw Error("Invalid serialization budget");
  const chunks: string[] = [], parents = new Set<object>(); let bytes = 0, buffer = "";
  const append = (text: string) => {
    bytes += /[^\x00-\x7f]/.test(text) ? utf8Bytes(text) : text.length;
    if (bytes > limit) throw Error("Executor serialization byte budget exhausted");
    buffer += text;
    if (buffer.length >= 8192) { chunks.push(buffer); buffer = ""; }
  };
  const string = (text: string) => {
    append('"');
    for (let i = 0; i < text.length;) {
      let end = Math.min(text.length, i + 1024);
      if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--;
      append(JSON.stringify(text.slice(i, end)).slice(1, -1)); i = end;
    }
    append('"');
  };
  const visit = (item: unknown, depth: number) => {
    if (depth > 64) throw Error("Executor serialization depth budget exhausted");
    if (item === null) { append("null"); return; }
    if (typeof item === "string") { string(item); return; }
    if (typeof item === "number" && Number.isFinite(item) || typeof item === "boolean") { append(JSON.stringify(item)); return; }
    if (typeof item !== "object") throw Error("Non-JSON capture value");
    if (parents.has(item)) throw Error("Cyclic capture value");
    parents.add(item);
    if (Array.isArray(item)) {
      append("["); for (let i = 0; i < item.length; i++) { if (i) append(","); visit(item[i], depth + 1); } append("]");
    } else {
      append("{"); let count = 0;
      for (const [key, child] of Object.entries(item)) {
        if (child === undefined) continue;
        if (count++) append(","); string(key); append(":"); visit(child, depth + 1);
      }
      append("}");
    }
    parents.delete(item);
  };
  visit(value, 0); chunks.push(buffer); return chunks.join("");
}
export const jsonBytes = (value: unknown, limit: number) => utf8Bytes(boundedJson(value, limit));

export function firstStackPreflight(sidecar: FirstStackSidecarV2, schedule: ResolvedSchedule, policy: { horizonUs: number; maxEvents: number }) {
  const e = FIRST_STACK_ENVELOPE;
  jsonBytes({ sidecar, schedule, policy }, e.semanticBytes);
  if (sidecar.operations.length > e.operations || sidecar.database.keys.length > e.keys || schedule.rows.length > e.roots) refuse("envelope", "Operation, key or offered-root envelope exceeded.");
  const dictionary = [...sidecar.database.keys, ...sidecar.nodes.map(n => n.id), ...sidecar.paths.map(p => p.id), ...sidecar.operations.map(o => o.id), ...schedule.rows.map(r => r.id)];
  const dictionaryBytes = dictionary.reduce((sum, key) => sum + utf8Bytes(key), 0);
  if (dictionaryBytes > e.dictionaryBytes) refuse("envelope.dictionary", "Cumulative dictionary byte envelope exceeded.");
  const counts = [...sidecar.nodes.flatMap(n => [n.workers, n.queue]), sidecar.database.maxSessions, sidecar.database.activeTransactions, sidecar.database.pendingQueries,
    sidecar.balancer.outstanding, sidecar.balancer.pending, sidecar.caller.connections, sidecar.caller.pending, ...sidecar.paths.flatMap(p => [p.connections, p.pending])];
  if (counts.some(n => !Number.isSafeInteger(n) || n < 0 || n > e.queueEntries)) refuse("envelope.queues", "Each queue, worker/session or pool count must fit the finite live-state envelope.");
  const apps = sidecar.nodes.filter(n => n.owner === "compute").length;
  const probes = apps * (Math.floor(policy.horizonUs / sidecar.balancer.intervalUs) + 1);
  // Transparent lower bound, not an exact forecast: foreground arrivals plus
  // probe starts alone. Queueing, path completion/deadline work adds more.
  const minimumEvents = schedule.rows.length + probes;
  if (!Number.isSafeInteger(probes) || minimumEvents > policy.maxEvents) refuse("envelope.events", "Offered roots and health probes alone exceed the event budget; shorten the horizon or reduce the workload.");
  return { revision: e.revision, dictionaryBytes, roots: schedule.rows.length, operations: sidecar.operations.length, apps,
    probes: { upperScheduledStarts: probes }, minimumEvents,
    paths: sidecar.paths.length + 1, attemptsPerRoot: 1, retry: "unsupported in compiler/2",
    liveCallsUpperBound: e.liveCalls, pendingEventsUpperBound: e.pendingEvents,
    eventForecast: { kind: "unknown", reason: "Completion, queue/deadline ordering and downstream fan-out depend on execution; runtime caps remain authoritative" },
    rssForecast: { kind: "unknown", reason: "Logical object counts do not predict process RSS; isolated host qualification remains required" },
    serialization: { summaryBytes: e.summaryBytes, frameBytes: e.frameBytes, totalCaptureBytes: e.captureBytes },
    eligibility: "internal qualification only; laptop/server host readiness unqualified" };
}


export class FirstStackCompileRefusal extends Error {
  constructor(readonly diagnostics: FirstStackDiagnostic[]) { super(diagnostics.map(d => `${d.path}: ${d.message}`).join("; ")); }
}
export function refuse(path: string, message: string, code = "FIRST_STACK_COMPILE"): never {
  throw new FirstStackCompileRefusal([{ code, path, message }]);
}
