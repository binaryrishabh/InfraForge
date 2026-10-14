import type { RunComparison, ReportStatement } from "@infraforge/contracts/reports";
import { buildRunReport, type StoredRun } from "../reports/report";
import { readRunInputs } from "../deployments/runInputs";
import { compareInputs } from "./inputs";
import { affectingActions, compareConduct } from "./conduct";
import { metric, normalizedFinalState } from "./outcomes";

const input = (v: unknown) => { try { return readRunInputs(v); } catch { return null; } };
type Attempt = StoredRun & { sourceRunId?: string | null };
// Identity of the conditions a challenge attempt ran under, all recorded on the attempt itself.
const conditions = (r: Attempt) => JSON.stringify([r.challengeId, r.challengeVersion, r.challengeSpecHash, r.seed, r.evaluationStopAtSimulatedSeconds, r.challengeExperiment ?? null]);
export function classifyComparison(first: StoredRun & { sourceRunId?: string | null; runtimeActive?: boolean }, second: typeof first): RunComparison {
  const rows: [typeof first, typeof first] = first.createdAt.getTime() < second.createdAt.getTime() ||
    (first.createdAt.getTime() === second.createdAt.getTime() && first.id < second.id) ? [first, second] : [second, first];
  const reports = [buildRunReport(rows[0]), buildRunReport(rows[1])] as const;
  const starting = compareInputs(input(rows[0].runInputs), input(rows[1].runInputs));
  const conduct = compareConduct(rows, [reports[0], reports[1]]);
  const [a, b] = reports.map((r) => r.terminal ?? r.checkpoint);
  const exact = !!reports[0].terminal && !!reports[1].terminal;
  const matchedDuration = exact ? a!.simulatedSeconds === b!.simulatedSeconds : null;
  const available = rows.every((r) => !["pending", "running", "live"].includes(r.status) && !r.runtimeActive);
  const deterministic = available && exact && matchedDuration && starting.grade === "same-starting-point" &&
    reports[0].provenance.simulationModelVersion === "1" && conduct.code === "same" &&
    !affectingActions(reports[0].actions).length && !affectingActions(reports[1].actions).length;
  const deterministicState = deterministic ? normalizedFinalState(a!) === normalizedFinalState(b!) ? "matches" : "differs" : "not-established";
  const strongest = available && exact && matchedDuration && conduct.code === "same" && starting.grade !== "side-by-side-only";
  const fact = (id: string, message: string, sources: string[]): ReportStatement => ({ id, message, sources });
  const attempts = rows.every((r) => r.challengeId);
  const challengeConditions = !attempts ? null : conditions(rows[0]) === conditions(rows[1]) ? "same" as const : "different" as const;
  const observed = [fact("starting", `Starting inputs: ${starting.grade}.`, ["runInputs"]),
    fact("conduct", `Recorded outcome-affecting conduct: ${conduct.code}.`, ["RunAction.parameters", "RunAction.appliedSimulatedSeconds", "RunAction.outcome"]),
    fact("horizon", exact ? `Exact terminal duration: ${a!.simulatedSeconds} s / ${b!.simulatedSeconds} s.` : "Exact final duration is not established for both runs.", ["terminalSnapshot.simulatedSeconds"])];
  const interpreted: ReportStatement[] = [];
  const challengeSources = ["challengeId", "challengeVersion", "challengeSpecHash", "runInputs.seed", "evaluationStopAtSimulatedSeconds", "challengeExperiment"];
  if (challengeConditions === "same") observed.push(fact("challenge-conditions", `Both runs are attempts at ${reports[0].run.challenge?.title ?? rows[0].challengeId} version ${rows[0].challengeVersion} under the same recorded challenge conditions: rules, workload, seed, evaluation second${rows[0].challengeExperiment ? " and scheduled fault" : ""}.`, challengeSources));
  reports.forEach((r, i) => { if (r.run.autoStopAtSimulatedSeconds != null) observed.push(fact(`matched-stop-${i}`,
    `Run ${i + 1} matched-stop target: ${r.run.autoStopAtSimulatedSeconds} s. ${r.terminal ? r.terminal.simulatedSeconds === r.run.autoStopAtSimulatedSeconds ? "The exact terminal capture reached that target." : `The exact terminal capture stopped at ${r.terminal.simulatedSeconds} s; matched stop was not reached.` : "Reaching it cannot be established without exact terminal evidence."}`,
    ["autoStopAtSimulatedSeconds", "terminalSnapshot.simulatedSeconds", "RunAction.parameters.trigger"])); });
  if (strongest && starting.grade === "one-change-design") interpreted.push(fact("design-pair",
    `Within this pair, the design is the only recorded starting-input difference. For this seed, this simulated stop time and InfraForge model ${reports[0].provenance.simulationModelVersion}, these final-state differences followed that design change. Another seed may produce a somewhat different result.`, ["runInputs", "RunAction", "terminalSnapshot"]));
  if (deterministic) interpreted.push(fact("determinism", deterministicState === "matches" ? "The normalized final simulated state matches under InfraForge model 1." :
    "These runs should match under InfraForge model 1, but they do not. This may indicate an InfraForge determinism defect.", ["runInputs", "RunAction", "terminalSnapshot"]));
  const unknown = [fact("single-pair", "A single pair cannot establish statistical significance, production reliability, real cloud behavior or general superiority across seeds.", ["comparison.scope"]),
    fact("series", "Continuous telemetry and all automatic scaling events are not retained. Dynamic resources have no starting-jitter alignment claim.", ["RunAction", "terminalSnapshot"])];
  if (starting.alignment.code === "shifted") unknown.push(fact("jitter-shift", "Random variation shifted for some shared resources. Treat final differences as evidence to investigate, not proof that the design change alone produced every difference.", ["runInputs.resources", "runInputs.seed", "runInputs.simulationModelVersion"]));
  if (challengeConditions === "different") unknown.push(fact("challenge-conditions", rows[0].challengeId === rows[1].challengeId
    ? `These attempts ran under different versions or recorded conditions of the same challenge (version ${rows[0].challengeVersion} and version ${rows[1].challengeVersion}). Their challenge results were judged by different rules.`
    : "These runs are attempts at different challenges, judged by different rules.", challengeSources));
  if (starting.grade === "side-by-side-only") unknown.push(fact("provenance", "Missing/different model or catalog provenance, input versions or ambiguous starting topology permit descriptive comparison only.", ["runInputs"]));
  for (const reason of conduct.reasons) unknown.push(fact(`conduct-${unknown.length}`, reason, ["RunAction", "chaosEvents"]));
  if (!exact) unknown.push(fact("checkpoint", "Diagnostic checkpoints may predate teardown. Final-state deltas are withheld unless both snapshots are exact terminal captures.", ["simulationState", "terminalSnapshot"]));
  const shared = [...new Set([...(a?.resources ?? []).map((r) => r.id), ...(b?.resources ?? []).map((r) => r.id)])].sort();
  const resources = shared.map((id) => { const x = a?.resources.find((r) => r.id === id), y = b?.resources.find((r) => r.id === id);
    return { id, earlierHealth: x?.health, laterHealth: y?.health, metrics: ([ ["cpu", "percentage points"], ["memory", "percentage points"], ["rps", "requests/s"], ["connections", "connections"] ] as const)
      .map(([field, unit]) => metric(field, unit, x?.[field], y?.[field], available && exact)) }; });
  const monthly = reports.map((r) => r.stages.find((s) => s.name === "CostEstimate")?.monthlyEstimateUsd);
  const costs = [metric("Terminal simulated hourly burn rate", "USD/hour", a?.burnRatePerHourUsd, b?.burnRatePerHourUsd, available && exact),
    metric("Accumulated simulated cost", "USD", a?.accumulatedCostUsd, b?.accumulatedCostUsd, available && exact && !!matchedDuration,
      "Accumulated-cost delta requires exact matching simulated durations."),
    metric("Design monthly estimate (CostEstimate gate)", "USD/month", monthly[0], monthly[1], starting.facets.catalog === "same",
      "Monthly-estimate delta requires compatible captured catalog provenance.")];
  return { version: 1, runs: [reports[0].run, reports[1].run], available,
    unavailableReason: available ? null : "Both runs must be inactive before comparing final evidence. Stop the live run or wait for deployment gates.",
    lineage: rows[1].sourceRunId === rows[0].id || rows[0].sourceRunId === rows[1].id ? "source-and-rerun" : rows[0].sourceRunId && rows[0].sourceRunId === rows[1].sourceRunId ? "siblings" : "unrelated",
    headline: !available || starting.grade === "side-by-side-only" ? "descriptive-only" : deterministicState === "differs" ? "determinism-mismatch" :
      deterministicState === "matches" ? "determinism-match" : strongest ? "matched-pair" : "starting-inputs-only",
    starting, conduct, evidence: { code: !a || !b ? "missing" : exact ? "both-exact" : reports.some((r) => r.terminal) ? "exact-and-checkpoint" : "checkpoints-only",
      states: [a ?? null, b ?? null], matchedDuration, deterministicState }, resources, costs,
    outcomes: [metric("Simulated duration", "s", a?.simulatedSeconds, b?.simulatedSeconds, available && exact),
      metric("Load", "fraction of declared target", a?.loadFraction, b?.loadFraction, available && exact),
      metric("Target load", "fraction of declared target", a?.targetLoadFraction, b?.targetLoadFraction, available && exact)],
    gates: [reports[0].stages, reports[1].stages], challengeConditions, observed, interpreted, unknown };
}
