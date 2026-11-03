import { createRequire } from "node:module";
import type { Resource } from "@infraforge/domain/resource";
import type { ReportCheckpoint } from "@infraforge/contracts/reports";
import { captureRunInputs } from "../../../apps/backend/deployments/runInputs";
import { createModel2Engine } from "../../../apps/backend/simulator/model2Engine";
import { captureSnapshot } from "../../../apps/backend/simulator/snapshot";
import { readRecords } from "../../../apps/backend/reports/records";
import { buildRunReport, type StoredRun } from "../../../apps/backend/reports/report";
import { classifyComparison } from "../../../apps/backend/comparison/classify";

const at = new Date("2026-11-03T00:00:00.000Z");
const resources: Resource[] = [
  { id: "lb", type: "Load Balancer", x: 0, y: 0 },
  { id: "app", type: "Virtual Machine", x: 1, y: 0, vmExecution: { version: 1, workers: 1, queuedRequests: 16 },
    vmMemory: { version: 1, baselineMiB: 0, requestMiB: 1, activeMiB: 0 } },
];
const topology = { resources, connectionLines: [{ id: "lb-app", sourceId: "lb", targetId: "app",
  sourceType: "Load Balancer" as const, targetType: "Virtual Machine" as const, port: 80 }] };
const ms = (n: number | null | undefined) => n == null ? "Unknown" : `${n.toFixed(3).replace(/\.?0+$/, "")} ms`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const reading = (html: string, label: string) => html.match(new RegExp(`<dt[^>]*>${escape(label)}</dt><dd[^>]*>(.*?)</dd>`))?.[1];

function measure(timeout: number, id: string) {
  const input = captureRunInputs(topology, { targetThroughput: 12000, throughputUnit: "per-minute", trafficShape: "steady", payloadSize: "light",
    workloadDynamics: { version: 1, arrivalProcess: "poisson", applicationCpuCv: 0.5 },
    clientRetry: { version: 1, maxAttempts: 3, backoffMs: 1, attemptTimeoutMs: timeout },
    workloadObjective: { version: 1, maxResponseMs: 20, targetSuccessPercent: 95 } }, "report-outcomes-proof");
  const engine = createModel2Engine(input, 4);
  for (let i = 0; i < 4; i++) engine.advance();
  const terminal = captureSnapshot(id, { model2: engine, tickCount: 4, pendingLogs: [], speed: 1,
    lastCheckpointAt: 0, accumulatedCostUsd: 0, topology, topologyRevision: 0, actions: new Map(),
    metricsComputedAt: at.toISOString(), metricsTopologyRevision: 0, acknowledge: null }, "terminal");
  const row: StoredRun = { id, infrastructureId: null, runName: id, status: "torn-down", resourceCount: 2,
    createdAt: at, updatedAt: at, stages: [], timeline: [], chaosEvents: [], seed: input.seed,
    workloadProfile: input.workloadProfile, runInputs: input, liveTopology: topology, simulationState: null,
    terminalSnapshot: JSON.parse(JSON.stringify(terminal)), topologyRevision: 0, actions: [], actionCount: 0 };
  const limits: string[] = [], parsed = readRecords(row, limits);
  return { row, report: buildRunReport(row), engineTraffic: engine.view().traffic,
    storedTraffic: parsed.terminal!.traffic!, evidence: engine.evidence(), limits,
    memoryMatches: JSON.stringify(parsed.terminal!.resources.find(r => r.id === "app")!.vmMemory) === JSON.stringify(engine.view().metrics.app!.vmMemory) };
}

// Same order as the comparison rows: last-second percentiles, whole-run percentile bounds, then the remaining measures.
const values = (t: NonNullable<ReportCheckpoint["traffic"]>) => [
  t.latencyMs.p50, t.latencyMs.p95, t.latencyMs.p99,
  t.wholeRun!.percentiles.p50!.highMs, t.wholeRun!.percentiles.p95!.highMs, t.wholeRun!.percentiles.p99!.highMs,
  t.completedRps, t.failedRps,
  t.clientRetry!.extraLoadFactor, t.objective!.worstCaseFraction! * 100, t.objective!.bestCaseFraction! * 100, t.clientRetry!.attemptsTimedOut,
];

export async function reportOutcomeProof() {
  // Resolve the web renderer in its own workspace. Dynamic component loading
  // keeps this cross-application proof outside both production dependency graphs.
  const requireWeb = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
  const { createElement } = requireWeb("react") as { createElement: (component: unknown, props: object) => unknown };
  const { renderToStaticMarkup } = requireWeb("react-dom/server") as { renderToStaticMarkup: (element: unknown) => string };
  const measurementsUrl = new URL("../../../apps/web/src/features/reports/components/ReportMeasurements.tsx", import.meta.url).href;
  const metricsUrl = new URL("../../../apps/web/src/features/reports/components/CompareMetrics.tsx", import.meta.url).href;
  const { ReportMeasurements } = await import(measurementsUrl) as { ReportMeasurements: unknown };
  const { CompareMetrics } = await import(metricsUrl) as { CompareMetrics: unknown };
  const a = measure(5, "a"), b = measure(20, "b"), repeat = measure(20, "b");
  const runs = [a, b].map(r => {
    const t = r.engineTraffic, retry = t.clientRetry!, objective = t.objective!;
    const html = renderToStaticMarkup(createElement(ReportMeasurements, { report: r.report, number: 1 }));
    const expected: Array<[string, string]> = [
      ["Offered requests/s", String(t.offeredRps)], ["Completed requests/s", String(t.completedRps)], ["Failed requests/s", String(t.failedRps)],
      ...(["p50", "p95", "p99"] as const).map(p => [p, ms(t.latencyMs[p])] as [string, string]),
      ["Attempts/s", String(retry.attemptRps)], ["Retries issued", String(retry.retriesIssued)], ["Recovered", String(retry.recovered)],
      ["Exhausted", String(retry.exhausted)], ["Gave up (deadline)", String(retry.givenUp)], ["Timed-out attempts", String(retry.attemptsTimedOut)],
      ["Wasted completions", String(retry.wastedCompletions)], ["Load factor", retry.extraLoadFactor!.toFixed(2).replace(/\.?0+$/, "")],
      ["Original requests", String(objective.offered)], ["In time", String(objective.good)],
    ];
    const fraction = (n: number, value: number) => `${n}/${objective.offered} (${(value * 100).toFixed(4).replace(/\.?0+$/, "")}%)`;
    const compositionMatches = [t.latency!.typical, t.latency!.slowestOnePercent].every(mean => !mean || html.includes(ms(mean.totalMs)));
    return { storedTraffic: r.storedTraffic, engineTraffic: t,
      markupMatches: expected.every(([label, value]) => reading(html, label) === value) && compositionMatches,
      objectiveMatches: JSON.stringify(r.evidence.objective) === JSON.stringify(objective) &&
        reading(html, "Measured in time") === fraction(objective.good, objective.measuredFraction!) &&
        reading(html, "Worst case") === fraction(objective.good, objective.worstCaseFraction!) &&
        reading(html, "Best case") === fraction(objective.good + objective.pending, objective.bestCaseFraction!),
      memoryMatches: r.memoryMatches };
  });
  const comparison = classifyComparison(a.row, b.row), rows = comparison.traffic ?? [];
  const av = values(a.engineTraffic), bv = values(b.engineTraffic);
  const comparisonHtml = renderToStaticMarkup(createElement(CompareMetrics, { metrics: rows, caption: "Traffic outcomes" }));
  const comparisonMarkupMatches = rows.every(m => {
    const row = comparisonHtml.match(new RegExp(`<tr[^>]*><th[^>]*>${escape(m.field)} .*?</tr>`))?.[0];
    const cells = [...(row ?? "").matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(match => match[1]);
    const format = (v: number | null) => v == null ? "unknown" : v.toLocaleString(undefined, { maximumFractionDigits: 6 });
    return cells[0] === format(m.earlier) && cells[1] === format(m.later) && cells[2]?.startsWith(`${m.delta! > 0 ? "+" : ""}${format(m.delta)} `);
  });
  return { runs, limits: [...a.limits, ...b.limits, ...repeat.limits], rows,
    repeatIdentical: JSON.stringify(b.evidence) === JSON.stringify(repeat.evidence),
    originalsIdentical: a.evidence.counts.offered === b.evidence.counts.offered && a.engineTraffic.offeredRps === b.engineTraffic.offeredRps,
    rowsMatch: rows.length === 12 && rows.every((m, i) => m.earlier === av[i] && m.later === bv[i] && m.delta === bv[i]! - av[i]!),
    comparisonMarkupMatches, timeoutAttempts: a.engineTraffic.clientRetry!.attemptsTimedOut!, changedDeltas: rows.map(m => m.delta),
    numbers: { seed: "report-outcomes-proof", seconds: 4, attemptTimeoutMs: [5, 20], originals: a.evidence.counts.offered,
      runs: [a.engineTraffic, b.engineTraffic], rows } };
}
