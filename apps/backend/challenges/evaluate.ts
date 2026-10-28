import { isActiveRunStatus } from "@infraforge/contracts/deployment";
import { PREDICTION_CHOICES } from "@infraforge/contracts/challenges";
import { RESOURCE_TYPES } from "@infraforge/domain/resource";
import type { RunAction } from "@infraforge/contracts/actions";
import type { ChallengeCriterion, ChallengeCriterionResult, ChallengeDefinition, ChallengeEvaluation, ChallengeStatus,
  ExperimentResult, PredictionQuestion, PredictionResult, RecordedExperiment } from "@infraforge/contracts/challenges";
import type { ReportCheckpoint, ReportStage } from "@infraforge/contracts/reports";
import { appServersBehindBalancer, busiestTypes, databaseConnections, genericSized, label, list, scaledOut, worstHealth, type Topology } from "./criteria";
import { REGISTRY, type ChallengeRegistry } from "./registry";
import { readStoredPrediction } from "./prediction";
import { FAULT_LABEL, isExperimentAction, readRecordedExperiment, recordedExperiment } from "./experiment";

export interface ChallengeAttemptRecord {
  challengeId: string; challengeVersion: number | null; challengeSpecHash: string | null;
  challengePrediction: unknown; predictionSubmittedAt: Date | null; evaluationStopAtSimulatedSeconds: number | null;
  challengeExperiment?: unknown;
}
export interface ChallengeEvidence {
  status: string; runtimeActive: boolean; input: Topology | null;
  stages: ReportStage[]; terminal: ReportCheckpoint | null; failure: string | null;
  actions?: RunAction[];
}

const GATES = ["Validate", "SecurityScan", "CostEstimate"] as const;
const usd = (n: number) => `$${n.toFixed(2)}`;

class Judge {
  readonly active: boolean;
  readonly atEvaluation: ReportCheckpoint | null;
  readonly experiment: ExperimentResult | null;
  constructor(readonly definition: ChallengeDefinition, readonly evidence: ChallengeEvidence, readonly plan: RecordedExperiment | null) {
    this.active = evidence.runtimeActive || isActiveRunStatus(evidence.status);
    const terminal = evidence.terminal;
    this.atEvaluation = terminal && terminal.simulatedSeconds === definition.evaluationSeconds ? terminal : null;
    this.experiment = plan ? this.experimentResult(plan) : null;
  }

  /* The scheduled fault, established only from its durable action: when it was
  applied, to what, and whether the model's fault window closed. */
  experimentResult(plan: RecordedExperiment): ExperimentResult {
    const action = this.evidence.actions?.find(isExperimentAction) ?? null;
    const base = { fault: plan.fault, targetResourceId: plan.targetResourceId, targetType: plan.targetType, atSimulatedSecond: plan.atSimulatedSecond,
      durationSimulatedSeconds: plan.durationSimulatedSeconds, appliedSimulatedSeconds: action?.appliedSimulatedSeconds ?? null,
      appliedAt: action?.appliedAt ?? null, endedSimulatedSeconds: null, baselineOverallHealth: action?.outcome?.baselineOverallHealth ?? null,
      targetHealthAtEvaluation: this.atEvaluation?.resources.find((r) => r.id === plan.targetResourceId)?.health ?? null,
      actionId: action?.id ?? null, sources: ["RunAction.parameters.trigger", "RunAction.appliedSimulatedSeconds", "RunAction.outcome"] };
    const what = `${FAULT_LABEL[plan.fault]} on ${plan.targetResourceId}`;
    if (!action || action.appliedSimulatedSeconds === null) {
      if (this.active && !action?.failureReason) return { ...base, state: "scheduled", detail: `${what} is scheduled for simulated second ${plan.atSimulatedSecond}.` };
      const reason = action?.failureReason ?? (this.evidence.failure ? `The run failed first: ${this.evidence.failure}` :
        this.evidence.terminal ? `The run stopped at second ${this.evidence.terminal.simulatedSeconds}, before the fault was due.` : "No application of the fault was recorded.");
      return { ...base, state: "not-applied", detail: `${what} was not applied. ${reason}` };
    }
    const params = action.parameters as { type?: string; resourceId?: string };
    if (action.appliedSimulatedSeconds !== plan.atSimulatedSecond || params.type !== plan.fault || params.resourceId !== plan.targetResourceId) {
      return { ...base, state: "not-applied", detail: `${what} was recorded at second ${action.appliedSimulatedSeconds}, which does not match the plan.` };
    }
    if (action.status === "completed" && action.outcome?.faultEnded) {
      if (action.completedSimulatedSeconds !== plan.atSimulatedSecond + plan.durationSimulatedSeconds) {
        return { ...base, state: "not-applied", detail: `${what} has no verified completion at its planned fault-end second.` };
      }
      return { ...base, state: "ended", endedSimulatedSeconds: action.completedSimulatedSeconds,
        detail: `${what} was applied at second ${action.appliedSimulatedSeconds}; the model's ${plan.durationSimulatedSeconds}-second fault window ended at second ${action.completedSimulatedSeconds}. A fault ending is not the same as recovery.` };
    }
    const stopped = !this.active && this.evidence.terminal ? ` The run stopped at second ${this.evidence.terminal.simulatedSeconds} while it was still active.` : "";
    // An interruption after application (a worker restart, a stop) is recorded on the action itself.
    const closed = (action.status === "failed" || action.status === "cancelled") && action.failureReason ? ` ${action.failureReason}` : "";
    return { ...base, state: "active", detail: `${what} was applied at second ${action.appliedSimulatedSeconds} for ${plan.durationSimulatedSeconds} simulated seconds.${stopped}${closed}` };
  }

  // A resilience attempt is judged on runtime evidence only if its fault happened exactly as planned.
  experimentMissing() {
    return this.experiment?.state === "not-applied" ? `${this.experiment.detail} This attempt is not judged as a resilience experiment.` : null;
  }
  stage(name: string) { return this.evidence.stages.find((s) => s.name === name && s.status === "completed") ?? null; }

  // Why a runtime measurement at the evaluation second does not exist.
  missingMeasurement() {
    const t = this.evidence.terminal, at = this.definition.evaluationSeconds;
    if (this.active) return `Waiting for simulated second ${at}.`;
    if (this.evidence.failure) return `The run failed before second ${at}: ${this.evidence.failure}`;
    if (t?.simulatedSeconds !== undefined) return `The run stopped at second ${t.simulatedSeconds}, before the evaluation second ${at}. Nothing after the stop is inferred.`;
    return `No exact final state was recorded, so second ${at} cannot be checked.`;
  }

  criterion(c: ChallengeCriterion): ChallengeCriterionResult {
    const base = { id: c.id, label: c.label };
    const pending = (detail: string, sources: string[]) => ({ ...base, status: this.active ? "pending" as const : "not-evaluated" as const, detail, sources });
    const decided = (met: boolean, detail: string, sources: string[]) => ({ ...base, status: met ? "met" as const : "not-met" as const, detail, sources });
    const input = this.evidence.input;
    switch (c.kind) {
      case "deployment-checks": {
        const done = GATES.filter((g) => this.stage(g));
        if (done.length === GATES.length) return decided(true, "Validate, SecurityScan and CostEstimate all completed.", ["stages"]);
        if (this.evidence.failure && !this.active) return decided(false, `The deployment checks did not complete: ${this.evidence.failure}`, ["stages", "timeline"]);
        return pending(done.length ? `Completed so far: ${done.join(", ")}.` : "The checks have not run yet.", ["stages"]);
      }
      case "min-app-servers": {
        if (!input) return pending("The attempt's captured design is unavailable.", ["runInputs"]);
        const count = appServersBehindBalancer(input);
        return decided(count >= c.count, `${count} app server${count === 1 ? "" : "s"} placed behind a load balancer; ${c.count} required.`, ["runInputs.connectionLines"]);
      }
      case "catalog-sizes": {
        if (!input) return pending("The attempt's captured design is unavailable.", ["runInputs"]);
        const generic = genericSized(input);
        return decided(!generic.length, generic.length ? `Still generic: ${list(generic)}.` : "Every app server and database has a catalog size.", ["runInputs.resources"]);
      }
      case "security-clean": {
        const scan = this.stage("SecurityScan");
        if (!scan) return pending("The security scan has not completed.", ["stages.SecurityScan"]);
        return decided(!scan.issues.length, scan.issues.length ? `${scan.issues.length} finding${scan.issues.length === 1 ? "" : "s"}: ${scan.issues.join("; ")}.` : "The scan reported no issues.", ["stages.SecurityScan.issues"]);
      }
      case "monthly-budget": {
        const estimate = this.stage("CostEstimate")?.monthlyEstimateUsd;
        if (estimate === undefined) return pending("The cost estimate has not completed.", ["stages.CostEstimate"]);
        return decided(estimate <= c.maxUsd, `Estimated ${usd(estimate)} a month; the limit is ${usd(c.maxUsd)}.`, ["stages.CostEstimate.monthlyEstimate"]);
      }
      case "survivors-unsaturated": {
        const t = this.atEvaluation, target = this.plan?.targetResourceId;
        const missing = this.experimentMissing();
        if (missing || !target) return { ...base, status: "not-evaluated" as const, detail: missing ?? "This challenge has no recorded experiment.", sources: ["RunAction"] };
        if (!t) return pending(this.missingMeasurement(), ["terminalSnapshot"]);
        const hot = t.resources.filter((r) => r.id !== target && (r.health === "saturated" || r.health === "failed")).map((r) => `${r.id} (${r.health}${r.cpu === undefined ? "" : `, ${r.cpu}% CPU`})`);
        return decided(!hot.length, hot.length ? `Besides ${target}, at second ${t.simulatedSeconds}: ${list(hot)}.` : `Apart from ${target}, no resource was saturated or failed at second ${t.simulatedSeconds}.`, ["terminalSnapshot.metrics", "RunAction.parameters"]);
      }
      case "overall-health": {
        const t = this.atEvaluation;
        if (!t?.health) return pending(this.missingMeasurement(), ["terminalSnapshot"]);
        return decided(c.allowed.includes(t.health as never), `Overall health was ${t.health} at second ${t.simulatedSeconds}.`, ["terminalSnapshot.overallHealth"]);
      }
      case "no-saturation": {
        const t = this.atEvaluation;
        if (!t) return pending(this.missingMeasurement(), ["terminalSnapshot"]);
        const hot = t.resources.filter((r) => r.health === "saturated" || r.health === "failed").map((r) => `${r.id} (${r.health}${r.cpu === undefined ? "" : `, ${r.cpu}% CPU`})`);
        return decided(!hot.length, hot.length ? `At second ${t.simulatedSeconds}: ${list(hot)}.` : `No resource was saturated or failed at second ${t.simulatedSeconds}.`, ["terminalSnapshot.metrics"]);
      }
      case "database-healthy": {
        const t = this.atEvaluation;
        if (!input) return pending("The attempt's captured design is unavailable.", ["runInputs"]);
        const dbs = input.resources.filter((r) => r.type === RESOURCE_TYPES.Database);
        if (!dbs.length) return decided(false, "The design has no database.", ["runInputs.resources"]);
        if (!t) return pending(this.missingMeasurement(), ["terminalSnapshot"]);
        const states = dbs.map((db) => ({ db, m: t.resources.find((r) => r.id === db.id) }));
        const unhealthy = states.filter(({ m }) => m?.health !== "healthy").map(({ db, m }) => `${label(db)} was ${m?.health ?? "unmeasured"}${m?.cpu !== undefined ? ` at ${m.cpu}% CPU` : ""}`);
        return decided(!unhealthy.length, unhealthy.length ? `${list(unhealthy)} at second ${t.simulatedSeconds}.` : `Every database was healthy at second ${t.simulatedSeconds}.`, ["terminalSnapshot.metrics"]);
      }
      case "database-connections": {
        const t = this.atEvaluation;
        if (!input) return pending("The attempt's captured design is unavailable.", ["runInputs"]);
        if (!t) return pending(this.missingMeasurement(), ["terminalSnapshot"]);
        const dbs = databaseConnections(t, input);
        if (!dbs.length) return decided(false, "The design has no database.", ["runInputs.resources"]);
        if (dbs.some((d) => d.connections === undefined)) return pending("Connection counts were not recorded for every database.", ["terminalSnapshot.metrics"]);
        const over = dbs.filter((d) => d.connections! > d.limit);
        return decided(!over.length, list(dbs.map((d) => `${d.name} had ${d.connections} of ${d.limit} connections`)) + ` at second ${t.simulatedSeconds}.`, ["terminalSnapshot.metrics", "terminalSnapshot.installedSkus"]);
      }
    }
  }

  prediction(q: PredictionQuestion, predicted: string): PredictionResult {
    const base = { id: q.id, prompt: q.prompt, predicted };
    const unknown = (detail: string, sources: string[]): PredictionResult => ({ ...base, actual: null, outcome: "unknown", detail, sources });
    const compare = (actual: string, matched: boolean, detail: string, sources: string[]): PredictionResult =>
      ({ ...base, actual, outcome: matched ? "matched" : "different", detail, sources });
    const t = this.atEvaluation, input = this.evidence.input;
    const choice = (value: string) => q.kind === "busiest-type" ? value : PREDICTION_CHOICES[q.kind].find((c) => c.value === value)?.label ?? value;
    switch (q.kind) {
      case "security-clean": {
        const scan = this.stage("SecurityScan");
        if (!scan) return unknown("The security scan did not complete.", ["stages.SecurityScan"]);
        const actual = scan.issues.length ? "no" : "yes";
        return compare(actual, actual === predicted, `The scan reported ${scan.issues.length} issue${scan.issues.length === 1 ? "" : "s"}.`, ["stages.SecurityScan.issues"]);
      }
      case "overall-health":
        if (!t?.health) return unknown(this.missingMeasurement(), ["terminalSnapshot"]);
        return compare(t.health, t.health === predicted, `Recorded overall health at second ${t.simulatedSeconds}: ${choice(t.health)}.`, ["terminalSnapshot.overallHealth"]);
      case "database-health": {
        if (!t || !input) return unknown(this.missingMeasurement(), ["terminalSnapshot"]);
        const ids = new Set(input.resources.filter((r) => r.type === RESOURCE_TYPES.Database).map((r) => r.id));
        const worst = worstHealth(t.resources.filter((r) => ids.has(r.id)).map((r) => r.health));
        if (!worst) return unknown("No database measurement was recorded.", ["terminalSnapshot.metrics"]);
        return compare(worst, worst === predicted, `${ids.size > 1 ? "The least healthy database" : "The database"} was ${worst} at second ${t.simulatedSeconds}.`, ["terminalSnapshot.metrics"]);
      }
      case "busiest-type": {
        if (!t || !input) return unknown(this.missingMeasurement(), ["terminalSnapshot"]);
        const top = busiestTypes(t, input);
        if (!top.types.length) return unknown("No CPU measurement was recorded.", ["terminalSnapshot.metrics"]);
        return compare(top.types.join(" / "), top.types.includes(predicted), `Highest known CPU at second ${t.simulatedSeconds}: ${list(top.types)} at ${top.cpu}%${top.types.length > 1 ? " (tied)" : ""}. Unknown CPU values are excluded. Autoscaled replicas count as Virtual Machines.`, ["terminalSnapshot.metrics"]);
      }
      case "baseline-health": {
        const e = this.experiment;
        if (!e || e.state === "not-applied") return unknown(e?.detail ?? "This challenge has no recorded experiment.", ["RunAction"]);
        if (!e.baselineOverallHealth) return unknown(e.state === "scheduled" ? e.detail : "The overall health at the moment of the fault was not recorded.", ["RunAction.outcome.baselineOverallHealth"]);
        return compare(e.baselineOverallHealth, e.baselineOverallHealth === predicted, `Overall health when the fault was applied at second ${e.appliedSimulatedSeconds}: ${choice(e.baselineOverallHealth)}.`, ["RunAction.outcome.baselineOverallHealth"]);
      }
      case "survivor-health": {
        const missing = this.experimentMissing(), target = this.plan?.targetResourceId;
        if (missing || !target) return unknown(missing ?? "This challenge has no recorded experiment.", ["RunAction"]);
        if (!t) return unknown(this.missingMeasurement(), ["terminalSnapshot"]);
        const worst = worstHealth(t.resources.filter((r) => r.id !== target).map((r) => r.health));
        if (!worst) return unknown("No measurement besides the target was recorded.", ["terminalSnapshot.metrics"]);
        return compare(worst, worst === predicted, `The least healthy resource other than ${target} was ${worst} at second ${t.simulatedSeconds}.`, ["terminalSnapshot.metrics"]);
      }
      case "target-health": {
        const missing = this.experimentMissing(), target = this.plan?.targetResourceId;
        if (missing || !target || !t) return unknown(missing ?? this.missingMeasurement(), ["RunAction", "terminalSnapshot"]);
        const actual = t.resources.find((r) => r.id === target)?.health;
        return actual ? compare(actual, actual === predicted, `${target} was ${actual} at second ${t.simulatedSeconds}.`, ["terminalSnapshot.metrics"])
          : unknown("The experiment target has no retained evaluation measurement.", ["terminalSnapshot.metrics"]);
      }
      case "scale-out": {
        if (!t) return unknown(this.missingMeasurement(), ["terminalSnapshot"]);
        const actual = scaledOut(t) ? "yes" : "no";
        const pools = Object.values(t.pools ?? {});
        return compare(actual, actual === predicted, pools.length ? list(pools.map((p) => `${p.lbId} ran ${p.currentReplicas} active app server${p.currentReplicas === 1 ? "" : "s"} (${p.baseVmIds.length} placed)`)) + ` at second ${t.simulatedSeconds}.` : "No autoscaled pool existed in this design.", ["terminalSnapshot.pools"]);
      }
    }
  }
}

function overall(active: boolean, results: ChallengeCriterionResult[]): ChallengeStatus {
  if (results.some((r) => r.status === "not-met")) return active ? "in-progress" : "not-met";
  if (active) return "in-progress";
  return results.every((r) => r.status === "met") ? "met" : "not-evaluated";
}

const STATUS_DETAIL: Record<ChallengeStatus, string> = {
  "in-progress": "The attempt is still running. Requirements are checked against the recorded state at the evaluation second.",
  met: "Every requirement was met by this attempt's recorded evidence.",
  "not-met": "At least one requirement was not met. Each requirement below shows the recorded fact it was judged on.",
  "not-evaluated": "Some requirements could not be checked because the evidence they need was not recorded.",
  unavailable: "This attempt's challenge definition is not part of this build, so it is not judged against different rules.",
};

/* Resolves the exact recorded version. A missing version, a different spec hash or a
different recorded plan leaves the attempt unavailable rather than re-judged. */
export function evaluateAttempt(attempt: ChallengeAttemptRecord, evidence: ChallengeEvidence, registry: ChallengeRegistry = REGISTRY): ChallengeEvaluation {
  const entry = attempt.challengeVersion === null ? null : registry.find(attempt.challengeId, attempt.challengeVersion);
  const prediction = readStoredPrediction(attempt.challengePrediction);
  const plan = attempt.challengeExperiment == null ? null : readRecordedExperiment(attempt.challengeExperiment);
  const expected = entry ? recordedExperiment(entry.definition) : null;
  const planMatches = (attempt.challengeExperiment == null) === (expected === null) && JSON.stringify(plan) === JSON.stringify(expected);
  const definitionMatches = !!entry && entry.hash === attempt.challengeSpecHash &&
    entry.definition.evaluationSeconds === attempt.evaluationStopAtSimulatedSeconds && planMatches;
  const submittedAt = attempt.predictionSubmittedAt?.toISOString() ?? "";
  if (!entry || !definitionMatches || !prediction) {
    return { challengeId: attempt.challengeId, version: attempt.challengeVersion ?? 0, title: entry?.definition.title ?? attempt.challengeId,
      evaluationSeconds: attempt.evaluationStopAtSimulatedSeconds ?? 0, status: "unavailable",
      statusDetail: prediction ? STATUS_DETAIL.unavailable : "The recorded prediction is unreadable, so this attempt is not judged.",
      definitionMatches, criteria: [], metCount: 0, total: 0, predictions: [], reasoning: prediction?.reasoning ?? null,
      predictionSubmittedAt: submittedAt, inspectNext: [], experiment: null };
  }
  const { definition } = entry;
  const judge = new Judge(definition, evidence, plan);
  const criteria = definition.criteria.map((c) => judge.criterion(c));
  let status = overall(judge.active, criteria);
  // A resilience attempt whose fault never happened as planned has nothing to be judged against.
  if (judge.experimentMissing() && !judge.active && status !== "not-met") status = "not-evaluated";
  // New observation exercises require their later evaluation even when a static
  // requirement already failed. Preserve the earlier versions' judging behavior.
  if (definition.experiment?.postFaultObservationSeconds && !judge.active && (!judge.atEvaluation || judge.experimentMissing())) status = "not-evaluated";
  const inspectNext: string[] = [];
  const hot = judge.atEvaluation?.resources.filter((r) => r.health === "saturated" || r.health === "failed").map((r) => r.id) ?? [];
  if (hot.length) inspectNext.push(`Open ${list(hot)} in the final-state table and follow their upstream connections.`);
  if (!judge.active && !judge.atEvaluation) inspectNext.push(`Run the attempt through to second ${definition.evaluationSeconds} so the runtime requirements can be checked.`);
  if (status === "not-met") inspectNext.push("Change one thing in the challenge design, then start a new attempt under the same workload and seed.");
  return { challengeId: definition.id, version: definition.version, title: definition.title, evaluationSeconds: definition.evaluationSeconds,
    status, statusDetail: STATUS_DETAIL[status], definitionMatches, criteria,
    metCount: criteria.filter((c) => c.status === "met").length, total: criteria.length,
    predictions: definition.predictions.map((q) => judge.prediction(q, prediction.answers[q.id] ?? "")),
    reasoning: prediction.reasoning, predictionSubmittedAt: submittedAt, inspectNext, experiment: judge.experiment };
}
