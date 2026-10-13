import { PREDICTION_CHOICES } from "@infraforge/contracts/challenges";
import { RESOURCE_TYPES } from "@infraforge/domain/resource";
import type { ChallengeCriterion, ChallengeCriterionResult, ChallengeDefinition, ChallengeEvaluation, ChallengeStatus,
  PredictionQuestion, PredictionResult } from "@infraforge/contracts/challenges";
import type { ReportCheckpoint, ReportStage } from "@infraforge/contracts/reports";
import { appServersBehindBalancer, busiestTypes, databaseConnections, genericSized, label, list, scaledOut, worstHealth, type Topology } from "./criteria";
import { findChallenge } from "./registry";
import { readStoredPrediction } from "./prediction";

export interface ChallengeAttemptRecord {
  challengeId: string; challengeVersion: number | null; challengeSpecHash: string | null;
  challengePrediction: unknown; predictionSubmittedAt: Date | null; evaluationStopAtSimulatedSeconds: number | null;
}
export interface ChallengeEvidence {
  status: string; runtimeActive: boolean; input: Topology | null;
  stages: ReportStage[]; terminal: ReportCheckpoint | null; failure: string | null;
}

const GATES = ["Validate", "SecurityScan", "CostEstimate"] as const;
const usd = (n: number) => `$${n.toFixed(2)}`;

class Judge {
  readonly active: boolean;
  readonly atEvaluation: ReportCheckpoint | null;
  constructor(readonly definition: ChallengeDefinition, readonly evidence: ChallengeEvidence) {
    this.active = evidence.runtimeActive || ["pending", "running", "live"].includes(evidence.status);
    const terminal = evidence.terminal;
    this.atEvaluation = terminal && terminal.simulatedSeconds === definition.evaluationSeconds ? terminal : null;
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
      case "overall-health": {
        const t = this.atEvaluation;
        if (!t?.health) return pending(this.missingMeasurement(), ["terminalSnapshot"]);
        return decided(c.allowed.includes(t.health as never), `Overall health was ${t.health} at second ${t.simulatedSeconds}.`, ["terminalSnapshot.overallHealth"]);
      }
      case "no-saturation": {
        const t = this.atEvaluation;
        if (!t) return pending(this.missingMeasurement(), ["terminalSnapshot"]);
        const hot = t.resources.filter((r) => r.health === "saturated" || r.health === "failed").map((r) => `${r.id} (${r.health}, ${r.cpu}% CPU)`);
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
        return compare(top.types.join(" / "), top.types.includes(predicted), `Highest CPU at second ${t.simulatedSeconds}: ${list(top.types)} at ${top.cpu}%${top.types.length > 1 ? " (tied)" : ""}. Autoscaled replicas count as Virtual Machines.`, ["terminalSnapshot.metrics"]);
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

export function evaluateAttempt(attempt: ChallengeAttemptRecord, evidence: ChallengeEvidence): ChallengeEvaluation {
  const entry = findChallenge(attempt.challengeId);
  const prediction = readStoredPrediction(attempt.challengePrediction);
  const definitionMatches = !!entry && entry.definition.version === attempt.challengeVersion && entry.hash === attempt.challengeSpecHash &&
    entry.definition.evaluationSeconds === attempt.evaluationStopAtSimulatedSeconds;
  const submittedAt = attempt.predictionSubmittedAt?.toISOString() ?? "";
  if (!entry || !definitionMatches || !prediction) {
    return { challengeId: attempt.challengeId, version: attempt.challengeVersion ?? 0, title: entry?.definition.title ?? attempt.challengeId,
      evaluationSeconds: attempt.evaluationStopAtSimulatedSeconds ?? 0, status: "unavailable",
      statusDetail: prediction ? STATUS_DETAIL.unavailable : "The recorded prediction is unreadable, so this attempt is not judged.",
      definitionMatches, criteria: [], metCount: 0, total: 0, predictions: [], reasoning: prediction?.reasoning ?? null,
      predictionSubmittedAt: submittedAt, inspectNext: [] };
  }
  const { definition } = entry;
  const judge = new Judge(definition, evidence);
  const criteria = definition.criteria.map((c) => judge.criterion(c));
  const status = overall(judge.active, criteria);
  const inspectNext: string[] = [];
  const hot = judge.atEvaluation?.resources.filter((r) => r.health === "saturated" || r.health === "failed").map((r) => r.id) ?? [];
  if (hot.length) inspectNext.push(`Open ${list(hot)} in the final-state table and follow their upstream connections.`);
  if (!judge.active && !judge.atEvaluation) inspectNext.push(`Run the attempt through to second ${definition.evaluationSeconds} so the runtime requirements can be checked.`);
  if (status === "not-met") inspectNext.push("Change one thing in the challenge design, then start a new attempt under the same workload and seed.");
  return { challengeId: definition.id, version: definition.version, title: definition.title, evaluationSeconds: definition.evaluationSeconds,
    status, statusDetail: STATUS_DETAIL[status], definitionMatches, criteria,
    metCount: criteria.filter((c) => c.status === "met").length, total: criteria.length,
    predictions: definition.predictions.map((q) => judge.prediction(q, prediction.answers[q.id] ?? "")),
    reasoning: prediction.reasoning, predictionSubmittedAt: submittedAt, inspectNext };
}
