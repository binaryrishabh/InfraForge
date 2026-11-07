import { resolve } from "node:path";
import { answers, attemptRow, definition } from "./challengeHarness";
import { buildRunReport } from "../reports/report";
import { durationSnapshot } from "../simulator/durationSnapshot";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";

export function durationReportFixture() {
  const ids = ["diagnose-query-admission", "diagnose-consumer-credit", "trace-a-saturation-cascade"];
  const rows = ids.map(id => { const d = definition(id); return attemptRow(d, d.starter!, answers(d, {}), {stopAt: 2}); });
  const reports = rows.map(row => buildRunReport({...row, terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot))}));
  const base = rows[0]!, snapshot = base.terminalSnapshot as {durationEvidence: ReturnType<typeof durationSnapshot>};
  const change = (fn: (s: typeof snapshot) => void) => {
    const s = structuredClone(snapshot); fn(s); return buildRunReport({...base, terminalSnapshot: s});
  };
  const child = Bun.spawnSync([Bun.which("bun")!, "--no-env-file", resolve(import.meta.dir, "../../../packages/simulation/tests/durationEvidence.fixture.ts")]);
  if (child.exitCode !== 0) throw Error(child.stderr.toString());
  type Source = Parameters<typeof durationSnapshot>[0];
  const finite = JSON.parse(child.stdout.toString()) as {samples: Source[]; directSamples: Source[]; cancelled: Source};
  const finiteEvidence = [...finite.samples, ...finite.directSamples, finite.cancelled].map(durationSnapshot);
  // A separate internal accounting run: no canvas topology or challenge evaluation is claimed.
  const finiteReports = finiteEvidence.map(e => buildRunReport({...base, challengeId: null, challengeVersion: null, challengeSpecHash: null,
    runInputs: null, liveTopology: null, workloadProfile: null, runName: "Internal finite IO accounting", resourceCount: e.resources.length, stages: [], terminalSnapshot: null,
    simulationState: {kind: "checkpoint", capturedAt: "2026-11-08T00:00:00.000Z",
      topologyRevision: 0, simulatedSeconds: e.throughUs / 1e6, metrics: {}, durationEvidence: JSON.parse(JSON.stringify(e))}}));
  return {reports, captures: rows.map(r => (r.terminalSnapshot as typeof snapshot).durationEvidence), finiteEvidence, finiteReports,
    missing: change(s => { delete (s as Partial<typeof s>).durationEvidence; }),
    nullHold: change(s => { s.durationEvidence.resources[0]!.busySlotUs = null; }),
    invalid: change(s => { s.durationEvidence.paths[0]!.reachedPhaseUs.connectionWaitUs = -1; }),
    duplicate: change(s => { s.durationEvidence.paths.push(s.durationEvidence.paths[0]!); }),
    checkpointOnly: buildRunReport({...base, simulationState: base.terminalSnapshot, terminalSnapshot: null}),
  };
}

export function realDurationSource() {
  const d = definition("diagnose-query-admission");
  const run = createModel2Engine(captureRunInputs(d.starter!, d.workload, "duration-owners"), 2);
  run.advance(); run.advance();
  return {run, source: run.evidence()};
}
if (import.meta.main) console.log(JSON.stringify(durationReportFixture()));
