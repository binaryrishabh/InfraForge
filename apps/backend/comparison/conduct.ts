import type { RunAction } from "@infraforge/contracts/actions";
import type { RunComparison, RunReport } from "@infraforge/contracts/reports";
import type { StoredRun } from "../reports/report";
import type { RunTopology } from "@infraforge/contracts/run-inputs";
import { canonical, normalizedTopology } from "./design";

export const SPEED_NOTE = "Simulation speed does not change tick math by itself. It can change when later human actions land in simulated time.";
export function affectingActions(actions: RunAction[]) { return actions.filter((a) => a.kind !== "speed" && a.kind !== "teardown"); }
function normalizedAction(action: RunAction) {
  let parameters: unknown = action.parameters;
  if (action.kind === "topology") {
    const topology = action.parameters as RunTopology & { expectedRevision: number; acceptedRevision?: number };
    parameters = { ...normalizedTopology(topology), resourceOrder: topology.resources.map((r) => r.id),
      expectedRevision: topology.expectedRevision, acceptedRevision: topology.acceptedRevision };
  }
  const { capturedAt: _capture, replicaId: _replica, ...outcome } = action.outcome ?? {};
  return { kind: action.kind, parameters, appliedSimulatedSeconds: action.appliedSimulatedSeconds,
    status: action.status, completedSimulatedSeconds: action.completedSimulatedSeconds, outcome };
}
export function compareConduct(rows: [StoredRun, StoredRun], reports: [RunReport, RunReport]): RunComparison["conduct"] {
  const reasons: string[] = [];
  rows.forEach((row, i) => {
    const report = reports[i]!;
    if (report.provenance.inputVersion !== 2 || !Array.isArray(row.chaosEvents) || row.chaosEvents.length) reasons.push(`Run ${i + 1} has legacy/request-only conduct evidence.`);
    if (!row.actions || (row.actionCount ?? row.actions.length) !== report.actions.length ||
        report.actions.some((a, j) => a.sequence !== j + 1)) reasons.push(`Run ${i + 1} action evidence is missing, malformed or truncated.`);
    if (report.actions.some((a) => a.status !== "completed" || a.appliedSimulatedSeconds === null || a.completedSimulatedSeconds === null)) reasons.push(`Run ${i + 1} contains unfinished or uncertain action effects.`);
  });
  return { code: reasons.length ? "unknown" : canonical(affectingActions(reports[0].actions).map(normalizedAction)) ===
      canonical(affectingActions(reports[1].actions).map(normalizedAction)) ? "same" : "different",
    actions: [reports[0].actions, reports[1].actions], speedNote: SPEED_NOTE, reasons };
}
