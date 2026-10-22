import { z } from "zod";
import type { FirstStackReport, FirstStackReportCapture, ReportJson } from "@infraforge/contracts/reports";
import { hash } from "./canonical";
import { inputDigest, readIsolatedCut, type IsolatedCut } from "./isolationProtocol";
import { firstStackComputeCost, unknownComputeCost } from "./providerCost";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), text = z.string().min(1);
const tail = z.discriminatedUnion("kind", [
  z.object({ p: z.number(), kind: z.literal("exact"), valueUs: count, method: z.literal("empirical-nearest-rank") }),
  z.object({ p: z.number(), kind: z.literal("bounded"), minUs: count, maxUs: count, method: z.literal("log2-histogram-rank") }).refine(t => t.minUs <= t.maxUs),
  z.object({ p: z.number(), kind: z.literal("unknown"), reason: text }),
]);
const distribution = z.object({ operation: text, outcome: z.enum(["completed", "rejected", "deadline-exceeded", "abandoned"]), count: count.positive(),
  percentiles: z.array(tail).min(3).max(8), histogram: z.object({ unit: z.literal("us"), counts: z.array(count).length(54), layout: text }) });
const event = z.object({ id: text, atUs: count, kind: text, resource: text,
  work: z.object({ rootId: text, callId: text, parentCallId: z.string().optional(), attempt: count, operation: text, offeredAt: count }).optional(),
  detail: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()])) });
export const ReportCaptureSchema = z.object({ schema: z.literal("first-stack-report-capture/1"),
  saturation: z.object({ cpu: z.json(), resources: z.json(), sampledAtUs: count.nullable(), network: z.json(), data: z.json(), storage: z.json() }),
  events: z.array(event).max(128), selection: z.object({ roots: z.array(text).max(3), omitted: count, journalOmitted: count, policy: z.literal("first-3-roots-and-global/1") }),
  unknown: z.array(text),
  allocationUsage: z.json().optional(),
});
const inputSchema = z.object({ schema: z.literal("infraforge-first-stack-submission/1").optional(), policy: z.object({ seed: text, horizonUs: count.positive() }),
  candidate: z.object({ schema: z.enum(["infraforge-first-stack-sidecar/2", "infraforge-first-stack-sidecar/3"]), nodes: z.json(), paths: z.json(), placement: z.json() }).passthrough(), recording: z.json() });
const recordedLock = z.object({ schema: z.literal("infraforge-first-stack-compile-lock/2"), sidecarHash: text,
  workloadIdentity: text, executedScheduleHash: text, profileHash: text });
const recordedSchedule = z.object({ schema: z.literal("infraforge-first-stack-resolved/1"), identity: text,
  executedScheduleHash: text, profileHash: text }).passthrough();
const cutSchema = z.object({ throughUs: count, timestampComplete: z.boolean(),
  counts: z.record(z.string(), count), unfinished: z.object({ notYetOffered: count, callers: count, pendingEvents: count }),
  completeness: z.object({ horizonReached: z.boolean(), allRootsTerminal: z.boolean(), aggregates: z.literal("observed-prefix"), usage: z.literal("prefix-only"), journalComplete: z.boolean() }),
  distributions: z.object({ population: text, censored: count, groups: z.array(distribution) }), omissions: z.object({ raw: count, samples: count, journal: count }),
  interruption: z.object({ classification: z.literal("executor-interrupted"), kind: text, reason: text }).nullable(),
  reportCapture: ReportCaptureSchema.optional(),
});
const resultSchema = z.object({ verification: z.enum(["unverified", "verified", "mismatch", "interrupted", "cancelled", "unavailable"]), reason: text.optional(), actual: z.string().nullable().optional() });

export interface FirstStackStoredReportRow {
  id: string; input: string; inputHash: string; engine: { source: string }; lock: ReportJson;
  status: string; browserCut: unknown; durablePrefix: unknown; result: unknown; resultHash: string | null;
  lineage: { infrastructureId: string; migratedFrom?: import("@infraforge/contracts/reports").RunReference }; createdAt: Date; updatedAt?: Date;
}
// Read recorded schemas only. This reader never compiles, executes or resolves latest.
export function firstStackReport(row: FirstStackStoredReportRow, serverTariffs?: unknown): FirstStackReport {
  const unknown = ["Cloud timing is assumption-only; physical throughput, full resident memory, physical DB buffer hits and full cost are Unknown."];
  const report: FirstStackReport = {
    schema: "infraforge-first-stack-report/1", origin: "unavailable", verification: { status: "pending", reason: null },
    identity: { source: row.engine.source, inputHash: row.inputHash, lock: row.lock, seed: null, topology: null, workload: null },
    interval: { requestedThroughUs: null, retainedThroughUs: null, fromUs: 0, boundary: "offers-at-or-before-cut; terminal-at-or-before-cut", scope: "retained-prefix-completed-only" },
    completeness: null, populations: null, latency: [], saturation: null,
    causality: { observation: "Observed", support: "supported-logical", complete: false, events: [], links: [], selectedRoots: [], omitted: null },
    failureTimeline: [], cost: unknownComputeCost("No eligible frozen tariff and complete selected allocation usage were recorded"), unknown,
  };
  try {
    if (inputDigest(row.input) !== row.inputHash) throw Error("Recorded input hash mismatch");
    const input = inputSchema.parse(JSON.parse(row.input));
    const lock = recordedLock.parse(row.lock), schedule = recordedSchedule.parse(input.recording);
    const { identity, ...scheduleBody } = schedule;
    if (hash(input.candidate) !== lock.sidecarHash || hash(scheduleBody) !== identity || identity !== lock.workloadIdentity ||
      schedule.executedScheduleHash !== lock.executedScheduleHash || schedule.profileHash !== lock.profileHash) throw Error("Recorded input disagrees with its immutable compile lock");
    report.identity.seed = input.policy.seed;
    report.identity.topology = { nodes: input.candidate.nodes, paths: input.candidate.paths, placement: input.candidate.placement };
    report.identity.workload = input.recording;
    report.interval.requestedThroughUs = input.policy.horizonUs;
    if (row.result !== null && row.result !== undefined) {
      if (hash(row.result) !== row.resultHash) throw Error("Recorded verification result hash mismatch");
      const result = resultSchema.parse(row.result);
      report.verification = { status: result.verification, reason: result.reason ?? null };
    }
    const server = row.durablePrefix !== null && row.durablePrefix !== undefined;
    const retained = readIsolatedCut((server ? row.durablePrefix : row.browserCut) as IsolatedCut, row.engine.source, row.inputHash);
    if (retained.cut.lock.schema !== "infraforge-first-stack-compile-lock/2") throw Error("Unsupported historical compile lock schema");
    if (hash(retained.cut.lock) !== hash(row.lock)) throw Error("Recorded capture compile lock mismatch");
    const cut = cutSchema.parse(retained.cut);
    if (cut.throughUs > input.policy.horizonUs) throw Error("Capture extends beyond recorded horizon");
    if (report.verification.status === "verified" && (!server || (row.result as { actual?: string }).actual !== retained.fingerprint ||
      !cut.completeness.horizonReached || cut.interruption)) throw Error("Verification has no matching completed server capture");
    report.origin = server ? "server" : "browser-untrusted";
    if (!server) unknown.push("Browser observations are untrusted; server verification has not supplied a durable prefix.");
    report.interval.retainedThroughUs = cut.throughUs;
    report.completeness = { ...cut.completeness, timestampComplete: cut.timestampComplete, omissions: cut.omissions, interruption: cut.interruption };
    const terminal = cut.distributions.groups.reduce((sum, d) => sum + d.count, 0);
    if (cut.counts.offered === undefined || cut.counts.completed === undefined || cut.counts.inFlight !== cut.unfinished.callers ||
      cut.distributions.censored !== cut.unfinished.callers || terminal + cut.unfinished.callers !== cut.counts.offered) throw Error("Capture population coverage mismatch");
    for (const [outcome, key] of [["completed", "completed"], ["rejected", "rejected"], ["deadline-exceeded", "deadlineExceeded"], ["abandoned", "abandoned"]]) {
      if (cut.counts[key!] !== cut.distributions.groups.filter(d => d.outcome === outcome).reduce((n, d) => n + d.count, 0)) throw Error("Capture outcome population mismatch");
    }
    const groups = new Set<string>();
    report.latency = cut.distributions.groups.map(d => {
      const key = JSON.stringify([d.operation, d.outcome]);
      if (groups.has(key) || d.histogram.counts.reduce((a, b) => a + b, 0) !== d.count) throw Error("Capture histogram coverage mismatch");
      groups.add(key);
      return { operation: d.operation, outcome: d.outcome, count: d.count, unit: "us", observation: "Observed", support: "assumption-only",
        percentiles: [0.5, 0.95, 0.99].map((p, i) => {
          const t = d.percentiles.find(t => t.p === p);
          if (!t || d.percentiles.filter(t => t.p === p).length !== 1) throw Error("Capture percentile definition mismatch");
          if (d.count < [2, 20, 100][i]!) return { p, kind: "unknown", reason: "Insufficient terminal samples for this tail rank" };
          return t;
        }) };
    });
    report.populations = { counts: cut.counts, unfinished: cut.unfinished, denominatorUs: cut.throughUs,
      goodputPerSecond: cut.throughUs ? cut.counts.completed * 1_000_000 / cut.throughUs : null,
      offeredPerSecond: cut.throughUs ? cut.counts.offered * 1_000_000 / cut.throughUs : null };
    if (!cut.completeness.horizonReached || !cut.timestampComplete) unknown.push("Execution retained a prefix; missing time and equal-time work are Unknown.");
    if (cut.unfinished.callers) unknown.push(`${cut.unfinished.callers} callers are right-censored; their future outcomes and latencies are Unknown.`);
    if (!cut.completeness.journalComplete) unknown.push("The retained journal is truncated; omitted causal transitions are Unknown.");
    if (cut.omissions.samples) unknown.push("Historical resource samples were omitted; aggregate counts do not restore a resource timeline.");
    if (cut.interruption) unknown.push(`Executor interrupted (${cut.interruption.kind}): ${cut.interruption.reason}`);
    if (!cut.reportCapture) unknown.push("Historical cut has no report capture; saturation and exact causal chains are Unknown.");
    else attachCapture(report, cut.reportCapture, cut.throughUs);
    // Tariffs are server data and never enter cut bytes, replay or browser input.
    // Only a matching completed server verification can qualify modeled usage.
    report.cost = server && report.verification.status === "verified"
      ? firstStackComputeCost(serverTariffs, cut.reportCapture?.allocationUsage, input.candidate, cut.throughUs, cut.timestampComplete)
      : unknownComputeCost("Compute usage has no matching completed server verification");
    if (report.cost.subtotal.kind === "Unknown") unknown.push(`Supported compute subtotal is Unknown: ${report.cost.subtotal.reason}`);
    for (const d of report.latency) for (const t of d.percentiles) if (t.kind === "unknown") unknown.push(`${d.operation}/${d.outcome}/p${t.p * 100}: ${t.reason}`);
  } catch (error) {
    report.origin = "unavailable"; report.verification = { status: "unknown", reason: "Recorded input, result or capture is unavailable/corrupt" };
    report.populations = null; report.latency = []; report.saturation = null;
    report.cost = unknownComputeCost("Recorded input, result or capture is unavailable/corrupt");
    report.completeness = null; report.interval.retainedThroughUs = null;
    report.causality = { ...report.causality, complete: false, events: [], links: [], selectedRoots: [], omitted: null }; report.failureTimeline = [];
    unknown.push(error instanceof Error ? error.message : "Recorded evidence unavailable");
  }
  return report;
}

function attachCapture(report: FirstStackReport, capture: Omit<FirstStackReportCapture, "allocationUsage">, throughUs: number) {
  const ids = new Set<string>();
  for (const e of capture.events) {
    if (ids.has(e.id) || e.atUs > throughUs) throw Error("Invalid retained causal event identity or interval");
    ids.add(e.id);
  }
  report.saturation = capture.saturation;
  report.unknown.push(...capture.unknown);
  if (capture.saturation.storage === null) report.unknown.push("Finite IO owner metrics are unavailable in this composition; missing IO is Unknown.");
  if (capture.saturation.sampledAtUs !== throughUs) report.unknown.push("Worker/queue resource snapshot is sampled; it does not cover the entire retained interval.");
  const omitted = capture.selection.omitted + capture.selection.journalOmitted;
  report.causality = { ...report.causality, events: capture.events, selectedRoots: capture.selection.roots, omitted,
    complete: false };
  report.unknown.push("Full per-request CPU, lock, IO and cache wait decomposition and worker queue ages are not retained by this journal revision; those causal links are Unknown.");
  if (omitted || capture.unknown.length) report.unknown.push("Exact causal chain is Unknown where journal or selected evidence was omitted; aggregate distributions remain independent.");
  // Link only matching call lifecycles with actual retained start/end events.
  // Adjacent timestamps and high CPU alone never establish causation.
  const pairs: Record<string, string> = { "caller-terminal": "caller-offered", "app-start": "app-admitted", "app-terminal": "app-start", "db-terminal": "db-admitted" };
  for (const e of capture.events) {
    const startKind = pairs[e.kind];
    const start = startKind && e.work ? capture.events.find(s => s.kind === startKind && s.resource === e.resource && s.work?.callId === e.work?.callId && s.work?.rootId === e.work?.rootId && s.atUs <= e.atUs) : undefined;
    if (start && e.work) report.causality.links.push({ rootId: e.work.rootId, from: start.id, to: e.id,
      reason: e.kind === "app-start" ? "app worker queue wait" : `${start.kind} → ${e.kind}: observed lifecycle (may include dependency waits)`,
      interval: { fromUs: start.atUs, toUs: e.atUs }, evidence: [start.id, e.id] });
    if (e.work?.parentCallId) {
      const parent = capture.events.find(s => s.atUs <= e.atUs && s.work?.callId === e.work?.parentCallId && s.work?.rootId === e.work?.rootId);
      if (parent && !report.causality.links.some(l => l.to === e.id)) report.causality.links.push({ rootId: e.work.rootId,
        from: parent.id, to: e.id, reason: "Recorded parent → child invocation", interval: null, evidence: [parent.id, e.id] });
    }
    if (e.kind === "lb-selected" && typeof e.detail.root === "string") {
      const child = capture.events.find(s => s.work?.callId === e.detail.id && s.work?.rootId === e.detail.root && s.atUs >= e.atUs);
      if (child) report.causality.links.push({ rootId: e.detail.root, from: e.id, to: child.id,
        reason: "Recorded LB choice → backend invocation", interval: null, evidence: [e.id, child.id] });
    }
    if (/rejected|deadline|fault|crash|partition|reset|unhealthy|intervention/.test(e.kind) || e.detail.outcome === "deadline-exceeded" || e.detail.outcome === "aborted") {
      report.failureTimeline.push({ atUs: e.atUs, kind: e.kind, resource: e.resource, evidence: e.id });
    }
  }
}
