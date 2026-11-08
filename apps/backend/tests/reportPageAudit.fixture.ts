// Page audit bridge: real public designs, production capture, JSON persistence and report parser.
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { captureSnapshot } from "../simulator/snapshot";
import type { SimulationInstance } from "../simulator/instance";
import { buildRunReport, type StoredRun } from "../reports/report";
import { runCostEstimation } from "../stages/costEstimation.stages";
import { answers, attemptRow, definition, REFERENCE } from "./challengeHarness";
import { cdnLayout, cdnWorkload } from "./cdnTtl.fixture";
import { monitoringLayout, monitoringWorkload } from "./monitoringCadence.fixture";
import { dnsLayout, dnsWorkload } from "./dnsDepth.fixture";

export function reportPageAuditFixture() {
  const challenge = (id: string) => ({layout: REFERENCE[id] ?? definition(id).starter!, workload: definition(id).workload});
  const lb = challenge("retrying-a-full-pool");
  lb.layout = {...lb.layout, resources: lb.layout.resources.map(r => r.type === "Load Balancer"
    ? {...r, circuitBreaker: {enabled: true, failureThreshold: 1, cooldownMs: 100}} : r)};
  const designs = [
    {id: "plain", ...challenge("split-the-capacity-budget")},
    {id: "cached", ...challenge("share-a-cache-fill")},
    {id: "queue", ...challenge("keep-waiting-work")},
    {id: "balancer", ...lb},
    {id: "cdn", layout: cdnLayout(60), workload: cdnWorkload},
    {id: "monitoring", layout: monitoringLayout(undefined, true), workload: monitoringWorkload},
    {id: "dns", layout: dnsLayout(), workload: dnsWorkload},
    {id: "memory", ...challenge("fit-a-request-in-memory")},
    {id: "replication", ...challenge("move-reads-off-the-writer")},
    {id: "function", ...challenge("bound-function-pool-pressure")},
    {id: "scheduler", ...challenge("queue-overlapping-jobs")},
    {id: "event-bus", ...challenge("open-one-subscriber")},
    {id: "gateway", ...challenge("protect-one-api-route")},
    {id: "security", ...challenge("find-the-denying-rule")},
  ];
  const cases = designs.map(({id, layout, workload}) => {
    const input = captureRunInputs(layout, workload, `page-audit-${id}`), engine = createModel2Engine(input, 4);
    const instance: SimulationInstance = {model2: engine, tickCount: 0, pendingLogs: [], speed: 1, lastCheckpointAt: 0,
      accumulatedCostUsd: 0, topology: input, topologyRevision: 0, actions: new Map(), acknowledge: null,
      metricsComputedAt: "2026-11-08T00:00:00.000Z", metricsTopologyRevision: 0};
    for (let second = 0; second < 4; second++) engine.advance();
    const snapshot = captureSnapshot(id, instance, "terminal"), now = snapshot.capturedAt;
    const cost = runCostEstimation(input.resources);
    const row: StoredRun = {id, infrastructureId: null, runName: `Page audit: ${id}`, status: "torn-down",
      resourceCount: input.resources.length, createdAt: new Date(now), updatedAt: new Date(now), topologyRevision: 0,
      stages: [{name: "CostEstimate", status: "completed", startedAt: now, completedAt: now, message: cost.summary, details: cost.details}],
      timeline: [], chaosEvents: [], workloadProfile: input.workloadProfile, seed: input.seed, runInputs: input, liveTopology: input,
      simulationState: null, terminalSnapshot: JSON.parse(JSON.stringify(snapshot))};
    return {id, row, report: buildRunReport(row)};
  });
  const missing = cases.map(({id, row}) => {
    const snapshot = structuredClone(row.terminalSnapshot) as ReturnType<typeof captureSnapshot>;
    for (const m of Object.values(snapshot.metrics)) {
      delete m.cache; delete m.applicationHelpers; delete m.cdn; delete m.database; delete m.databaseReplication;
      delete m.queueWork; delete m.asyncQueue; delete m.monitoring; delete m.monitoringBackend;
    }
    delete (snapshot as Partial<typeof snapshot>).dnsEvidence; delete (snapshot as Partial<typeof snapshot>).durationEvidence;
    return {id, report: buildRunReport({...row, terminalSnapshot: snapshot})};
  });
  const plain = cases[0]!.row, cached = cases[1]!.row;
  const invalid = structuredClone(cached.terminalSnapshot) as ReturnType<typeof captureSnapshot>;
  invalid.metrics.cache!.cache!.hits = -1;
  const noReadings = cases.map(({id, row}) => {
    const snapshot = structuredClone(row.terminalSnapshot) as ReturnType<typeof captureSnapshot>;
    snapshot.metrics = {};
    return {id, report: buildRunReport({...row, terminalSnapshot: snapshot})};
  });
  const budgetDefinition = definition("split-the-capacity-budget");
  const budgetRow = attemptRow(budgetDefinition, REFERENCE[budgetDefinition.id]!, answers(budgetDefinition, {}), {stopAt: 4});
  return {cases: cases.map(({id, report}) => ({id, report})), missing, noReadings,
    invalid: buildRunReport({...cached, terminalSnapshot: invalid}),
    checkpointOnly: buildRunReport({...plain, simulationState: plain.terminalSnapshot, terminalSnapshot: null}),
    budgetOnly: buildRunReport({...budgetRow, stages: [], terminalSnapshot: null}),
  };
}
if (import.meta.main) console.log(JSON.stringify(reportPageAuditFixture()));
