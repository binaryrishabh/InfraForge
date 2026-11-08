import { resolve } from "node:path";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { captureSnapshot } from "../simulator/snapshot";
import { dnsSnapshot } from "../simulator/dnsSnapshot";
import type { SimulationInstance } from "../simulator/instance";
import { buildRunReport, type StoredRun } from "../reports/report";
import { dnsLayout, dnsWorkload } from "./dnsDepth.fixture";

export function dnsReportFixture() {
  const cases = [undefined, 1].map(ttl => {
    const input = captureRunInputs(dnsLayout(ttl), dnsWorkload, "dns-report"), run = createModel2Engine(input, 4);
    const instance: SimulationInstance = {model2: run, tickCount: 0, pendingLogs: [], speed: 1, lastCheckpointAt: 0,
      accumulatedCostUsd: 0, topology: input, topologyRevision: 0, actions: new Map(), acknowledge: null,
      metricsComputedAt: "2026-11-08T00:00:00.000Z", metricsTopologyRevision: 0};
    for (let s = 0; s < 4; s++) run.advance();
    const raw = run.evidence(), before = run.view(), snapshot = captureSnapshot("dns-report", instance, "terminal");
    if (JSON.stringify(raw) !== JSON.stringify(run.evidence()) || JSON.stringify(before) !== JSON.stringify(run.view())) throw Error("Capture changed engine state");
    const row: StoredRun = {id: "dns-report", infrastructureId: null, runName: "DNS evidence", status: "torn-down", resourceCount: input.resources.length,
      createdAt: new Date(snapshot.capturedAt), updatedAt: new Date(snapshot.capturedAt), topologyRevision: 0, stages: [], timeline: [], chaosEvents: [],
      workloadProfile: input.workloadProfile, seed: input.seed, simulationState: JSON.parse(JSON.stringify(captureSnapshot("dns-report", instance, "checkpoint"))),
      runInputs: input, liveTopology: input, terminalSnapshot: JSON.parse(JSON.stringify(snapshot))};
    return {ttl: ttl ?? null, raw, captured: snapshot.dnsEvidence, report: buildRunReport(row), row};
  });
  const base = cases[0]!.row;
  type Snapshot = ReturnType<typeof captureSnapshot>;
  const variant = (change: (snapshot: Partial<Snapshot>) => void, checkpointOnly = false) => {
    const snapshot = structuredClone(base.terminalSnapshot) as Snapshot; change(snapshot);
    return buildRunReport({...base, simulationState: checkpointOnly ? snapshot : null, terminalSnapshot: checkpointOnly ? null : snapshot});
  };
  const child = Bun.spawnSync([Bun.which("bun")!, "--no-env-file", resolve(import.meta.dir, "../../../packages/simulation/tests/dnsEvidence.fixture.ts")]);
  if (child.exitCode !== 0) throw Error(child.stderr.toString());
  const internalRaw = JSON.parse(child.stdout.toString()) as Array<Parameters<typeof dnsSnapshot>[0]>;
  const internalEvidence = internalRaw.map(dnsSnapshot);
  const internalReports = internalEvidence.map(e => buildRunReport({...base, runInputs: null, liveTopology: null, workloadProfile: null,
    runName: "Internal DNS accounting", terminalSnapshot: null,
    simulationState: {simulatedSeconds: e.throughUs / 1e6, metrics: {}, dnsEvidence: JSON.parse(JSON.stringify(e))}}));
  return {cases: cases.map(({row: _row, ...c}) => c), internalRaw, internalEvidence, internalReports,
    missing: variant(s => {delete s.dnsEvidence;}),
    nullCounter: variant(s => {s.dnsEvidence!.resolvers[0]!.hits = null;}),
    invalid: variant(s => {s.dnsEvidence!.resolvers[0]!.queries = -1;}),
    duplicate: variant(s => {s.dnsEvidence!.resolvers.push(s.dnsEvidence!.resolvers[0]!);}),
    checkpointOnly: variant(() => {}, true),
  };
}
if (import.meta.main) console.log(JSON.stringify(dnsReportFixture()));
