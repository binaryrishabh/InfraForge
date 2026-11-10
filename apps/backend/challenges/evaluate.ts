import { isActiveRunStatus } from "@infraforge/contracts/deployment";
import { findSku } from "@infraforge/catalog";
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
import { sameScenarioValue, verifiedScenario } from "./scenario";
import type { RecordedScenario } from "@infraforge/contracts/challenges";
import type { RunInputs } from "@infraforge/contracts/run-inputs";
import { orderedScenarioSteps } from "@infraforge/simulation/model2-run";
import { QueueWorkSchema } from "../reports/queueWorkSchema";
import { WholeRunSchema } from "../reports/wholeRunSchema";
import { SecurityMetricsSchema } from "../reports/securitySchema";
import { evaluatePoolInService } from "./poolCriterion";
import { isDepthCriterion, evaluateDepthCriterion } from "./depthCriteria";
import { evaluateMonitoringDelivery } from "./monitoringCriterion";
import { evaluateDatabaseRedundancy } from "./databaseRedundancyCriterion";
import { evaluateStartupCapacity } from "./startupCapacityCriterion";

export interface ChallengeAttemptRecord {
  challengeId: string; challengeVersion: number | null; challengeSpecHash: string | null;
  challengePrediction: unknown; predictionSubmittedAt: Date | null; evaluationStopAtSimulatedSeconds: number | null;
  challengeExperiment?: unknown;
  challengeScenario?: unknown;
}
export interface ChallengeEvidence {
  topologyRevision?: number;
  topologyUnchanged?: boolean;
  status: string; runtimeActive: boolean; input: Topology | null;
  stages: ReportStage[]; terminal: ReportCheckpoint | null; failure: string | null;
  stageEvidence?: Readonly<Record<string, boolean>>;
  actions?: RunAction[];
  actionCount?: number;
  runInputs?: RunInputs | null;
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
  stage(name: string) {
    if ((this.definition.scenario || this.definition.criteria.some(c => c.kind === "firewall-admission-budget")) && this.evidence.stageEvidence?.[name] !== true) return null;
    return this.evidence.stages.find((s) => s.name === name && s.status === "completed") ?? null;
  }

  // Every scenario criterion must have all applicable, valid evidence before it
  // can decide either success or failure. Historical criteria retain their rules.
  scenarioCriterionProblem(c: ChallengeCriterion): string | null {
    if (isDepthCriterion(c)) return this.atEvaluation?.measurementFreshness === "current-revision" ? null : "A current evaluation measurement was not recorded.";
    const input = this.evidence.input, terminal = this.atEvaluation;
    if (["overall-health", "no-saturation", "database-healthy", "database-connections", "terminal-p95", "survivors-unsaturated", "backend-admission-budget", "queue-work", "queue-ready-age", "firewall-admission-budget"].includes(c.kind) &&
      terminal?.measurementFreshness !== "current-revision") return "A current evaluation measurement was not recorded.";
    const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
    const health = (ids: string[]) => !!terminal && ids.every(id => {
      const rows = terminal.resources.filter(r => r.id === id);
      return rows.length === 1 && ["healthy", "degraded", "saturated", "failed"].includes(rows[0]!.health ?? "");
    });
    const allHealth = () => !!input?.resources.length && !!terminal &&
      terminal.resources.length === input.resources.length && health(input.resources.map(r => r.id));
    switch (c.kind) {
      case "database-redundancy":
      case "startup-capacity":
        return null; // Dedicated evaluator checks its exact terminal evidence below.
      case "deployment-checks":
        return GATES.every(g => this.stage(g)) ? null : "Complete, valid deployment-check evidence was not recorded.";
      case "security-clean":
        return this.stage("SecurityScan") ? null : "Complete, valid security-scan findings were not recorded.";
      case "monthly-budget":
        return finite(this.stage("CostEstimate")?.monthlyEstimateUsd) ? null : "A valid monthly estimate was not recorded.";
      case "min-app-servers":
      case "catalog-sizes":
        return input ? null : "The attempt's captured design is unavailable.";
      case "overall-health":
        return allHealth() && ["healthy", "degraded", "saturated", "critical"].includes(terminal?.health ?? "")
          ? null : "Complete resource and overall health measurements were not recorded.";
      case "no-saturation":
        return allHealth() ? null : "Known health was not recorded for every captured resource.";
      case "database-healthy": {
        if (!input) return "The attempt's captured design is unavailable.";
        const ids = input.resources.filter(r => r.type === RESOURCE_TYPES.Database).map(r => r.id);
        return !ids.length || health(ids) ? null : "Known health was not recorded for every database.";
      }
      case "database-connections": {
        if (!input) return "The attempt's captured design is unavailable.";
        const dbs = input.resources.filter(r => r.type === RESOURCE_TYPES.Database);
        return dbs.every(db => {
          const rows = terminal?.resources.filter(r => r.id === db.id) ?? [], count = rows[0]?.connections;
          const sku = terminal?.installedSkus?.[db.id] ?? db.skuId;
          const capacity = sku ? findSku(sku) : null;
          return rows.length === 1 && finite(count) && Number.isSafeInteger(count) &&
            (!sku || capacity?.category === "Database" && finite(capacity.maxConnections) && capacity.maxConnections > 0);
        }) ? null : "Valid session counts and capacity were not recorded for every database.";
      }
      case "terminal-p95": {
        const traffic = terminal?.traffic;
        return traffic && finite(traffic.offeredRps) && finite(traffic.failedRps) && finite(traffic.completedRps) && traffic.completedRps > 0 &&
          finite(traffic.latencyMs.p50) && finite(traffic.latencyMs.p95) && traffic.latencyMs.p50 <= traffic.latencyMs.p95
          ? null : "Complete, valid completed-request latency evidence was not recorded.";
      }
      case "survivors-unsaturated":
        return this.plan && input && health(input.resources.filter(r => r.id !== this.plan!.targetResourceId).map(r => r.id))
          ? null : "Complete experiment survivor measurements were not recorded.";
      case "caller-outcomes":
      case "monitoring-delivery":
      case "pool-in-service":
      case "backend-admission-budget":
      case "queue-work":
      case "queue-ready-age":
      case "firewall-admission-budget":
        // Counter completeness and the cumulative window are checked below.
        return null;
    }
  }

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
    if (c.kind === "database-redundancy" || c.kind === "startup-capacity") {
      if (this.active || this.evidence.topologyUnchanged !== true || this.atEvaluation?.topologyRevision !== this.evidence.topologyRevision) {
        return {...base, status: "not-evaluated", detail: "Finished evidence on the unchanged captured topology with matching terminal revision is required.", sources: ["runInputs", "liveTopology", "terminalSnapshot.topologyRevision"]};
      }
      const result = c.kind === "startup-capacity" ? evaluateStartupCapacity(c, this.evidence.input, this.atEvaluation, this.definition.evaluationSeconds) : evaluateDatabaseRedundancy(c, this.evidence.input, this.atEvaluation, this.definition.evaluationSeconds);
      return {...base, status: result.met === undefined ? "not-evaluated" : result.met ? "met" : "not-met", detail: result.detail, sources: result.sources};
    }
    if (c.kind === "monitoring-delivery") {
      if (this.evidence.topologyUnchanged !== true || this.atEvaluation?.topologyRevision !== this.evidence.topologyRevision) {
        return {...base, status: "not-evaluated", detail: "An unchanged captured topology and matching terminal revision are required.", sources: ["runInputs", "liveTopology", "topologyRevision", "terminalSnapshot.topologyRevision"]};
      }
      const result = evaluateMonitoringDelivery(c, this.evidence.input, this.atEvaluation, this.definition.evaluationSeconds, this.active);
      return {...base, status: result.met === undefined ? "not-evaluated" : result.met ? "met" : "not-met", detail: result.detail, sources: result.sources};
    }
    if (c.kind === "pool-in-service") {
      if (this.evidence.topologyUnchanged !== true || this.atEvaluation?.topologyRevision !== this.evidence.topologyRevision) {
        return {...base, status: "not-evaluated", detail: "An unchanged captured topology and matching terminal revision are required.", sources: ["runInputs", "liveTopology", "topologyRevision", "terminalSnapshot.topologyRevision"]};
      }
      const result = evaluatePoolInService(c, this.evidence.input, this.atEvaluation, this.definition.evaluationSeconds, this.active);
      return {...base, status: result.met === undefined ? "not-evaluated" : result.met ? "met" : "not-met", detail: result.detail, sources: result.sources};
    }
    const pending = (detail: string, sources: string[]) => ({ ...base, status: this.active ? "pending" as const : "not-evaluated" as const, detail, sources });
    const decided = (met: boolean, detail: string, sources: string[]) => ({ ...base, status: met ? "met" as const : "not-met" as const, detail, sources });
    // A fixed-load latency lab uses the same captured terminal evidence as a scenario.
    const missing = this.definition.scenario || isDepthCriterion(c) || c.kind === "caller-outcomes" || c.kind === "terminal-p95" || c.kind === "backend-admission-budget" || c.kind === "queue-work" || c.kind === "queue-ready-age" || c.kind === "firewall-admission-budget" ? this.scenarioCriterionProblem(c) : null;
    if (missing) return pending(missing, ["runInputs", "stages", "terminalSnapshot"]);
    const input = this.evidence.input;
    if (isDepthCriterion(c)) {
      const result = evaluateDepthCriterion(c, input, this.atEvaluation);
      return result.met === undefined ? pending(result.detail, result.sources) : decided(result.met, result.detail, result.sources);
    }
    switch (c.kind) {
      case "firewall-admission-budget": {
        const t = this.atEvaluation, sources = ["terminalSnapshot.metrics.security.firewall", "runInputs.resources"];
        if (!t || !input) return pending(this.missingMeasurement(), sources);
        if (input.resources.filter(r => r.id === c.resourceId && r.type === RESOURCE_TYPES.Firewall).length !== 1) return pending("The named firewall was not retained in the captured design.", sources);
        const rows = t.resources.filter(r => r.id === c.resourceId), parsed = SecurityMetricsSchema.safeParse(rows[0]?.security);
        const f = parsed.success ? parsed.data.firewall : undefined;
        if (rows.length !== 1 || !f || f.policyDenied == null || f["flow-capacity"] == null) return pending("Complete firewall admission counters were not recorded; absent refusals are Unknown.", sources);
        return decided(f.admissions >= c.minAdmissions && f.policyDenied <= c.maxPolicyDenied && f["flow-capacity"] <= c.maxCapacityRefused,
          `Through second ${t.simulatedSeconds}, ${c.resourceId}: ${f.admissions} tracked admissions (minimum ${c.minAdmissions}), ${f.policyDenied} policy denials (maximum ${c.maxPolicyDenied}), ${f["flow-capacity"]} flow capacity refusals (maximum ${c.maxCapacityRefused}); occupancy ${f.occupancy}/${f.limit}. Includes probes; this is not caller availability.`, sources);
      }
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
      case "terminal-p95": {
        const t = this.atEvaluation, traffic = t?.traffic;
        if (!t || !traffic || traffic.latencyMs.p95 === null || traffic.completedRps <= 0) return pending("No completed-request latency measurement exists at the evaluation second.", ["terminalSnapshot.traffic"]);
        return decided(traffic.latencyMs.p95 <= c.maxMs, `At second ${t.simulatedSeconds}, p95 was ${traffic.latencyMs.p95.toFixed(3)} ms from ${traffic.completedRps} completed requests; the limit is ${c.maxMs} ms.`, ["terminalSnapshot.traffic"]);
      }
      case "caller-outcomes": {
        const t = this.atEvaluation, parsed = WholeRunSchema.safeParse(t?.traffic?.wholeRun), w = parsed.success ? parsed.data : null;
        const sources = ["terminalSnapshot.traffic.wholeRun"];
        if (!input || !t || t.measurementFreshness !== "current-revision" || !w || w.throughSecond !== t.simulatedSeconds) return pending("Current cumulative caller outcomes through the evaluation second are required.", sources);
        const populations = [w.completed, w.failed, w.deadlineExceeded, w.abandoned, w.inFlight];
        if (!populations.every(n => Number.isSafeInteger(n) && n >= 0) || !Number.isSafeInteger(populations.reduce((a,b) => a+b, 0))) return pending("Complete safe caller populations are required.", sources);
        const unsuccessful = w.failed + w.deadlineExceeded + w.abandoned;
        return decided(w.completed >= c.minCompleted && unsuccessful <= c.maxUnsuccessful,
          `Through second ${t.simulatedSeconds}: ${w.completed} completed (minimum ${c.minCompleted}); ${unsuccessful} unsuccessful (${w.failed} failed + ${w.deadlineExceeded} deadline exceeded + ${w.abandoned} abandoned; maximum ${c.maxUnsuccessful}); ${w.inFlight} in flight, not counted as successful or unsuccessful. This is a fixed-horizon count, not an availability guarantee.`, sources);
      }
      case "queue-ready-age": {
        const t = this.atEvaluation, sources = ["terminalSnapshot.metrics.asyncQueue", "terminalSnapshot.metrics.queueWork", "runInputs.resources"];
        if (!t || !input) return pending(this.missingMeasurement(), sources);
        const targets = input.resources.filter(r => r.id === c.resourceId && r.type === RESOURCE_TYPES.MessageQueue && r.asyncQueue?.enabled);
        const rows = t.resources.filter(r => r.id === c.resourceId), q = rows[0]?.asyncQueue, parsed = QueueWorkSchema.safeParse(rows[0]?.queueWork);
        if (targets.length !== 1 || rows.length !== 1 || !q || ![1, 2].includes(q.version) || !parsed.success || parsed.data.throughSecond !== t.simulatedSeconds ||
          q.readyDepth === null || !Number.isSafeInteger(q.readyDepth) || q.readyDepth < 0 || q.readyDepth !== parsed.data.ready) {
          return pending("Matching ready depth and complete queue counters for the named enabled queue at the evaluation second are required.", sources);
        }
        const age = q.oldestReadyAgeSeconds;
        if (q.readyDepth === 0) {
          if (age !== null) return pending("An empty ready population must retain Unknown age, not an invented age.", sources);
          return decided(true, `At second ${t.simulatedSeconds}, ${c.resourceId} had 0 ready messages. Oldest ready age is Unknown because no message was ready; the ready-age requirement has no waiting message to exceed ${c.maxAgeSeconds} seconds. This does not prove all work finished.`, sources);
        }
        if (age === null || !Number.isFinite(age) || age < 0 || age > t.simulatedSeconds!) return pending("A valid oldest ready message age was not recorded for the nonempty ready population.", sources);
        return decided(age <= c.maxAgeSeconds, `At second ${t.simulatedSeconds}, ${c.resourceId} had ${q.readyDepth} ready messages; oldest ready age was ${age} seconds (maximum ${c.maxAgeSeconds}). This is one sample, not a whole-run wait target or drain time.`, sources);
      }
      case "queue-work": {
        const t = this.atEvaluation;
        const sources = ["terminalSnapshot.metrics.queueWork", "runInputs.resources"];
        if (!t || !input) return pending(this.missingMeasurement(), sources);
        const targets = input.resources.filter(r => r.id === c.resourceId && r.type === RESOURCE_TYPES.MessageQueue && r.asyncQueue?.enabled);
        if (targets.length !== 1) return pending("The captured design must retain the named enabled queue; no replacement is inferred.", sources);
        const rows = t.resources.filter(r => r.id === c.resourceId), parsed = QueueWorkSchema.safeParse(rows[0]?.queueWork);
        if (rows.length !== 1 || !parsed.success || parsed.data.throughSecond !== t.simulatedSeconds) return pending("Complete queue work counters through the evaluation second were not recorded.", sources);
        const q = parsed.data;
        const outstanding = q.ready + q.inFlight + q.scheduled;
        return decided(q.acknowledged >= c.minAcknowledged && outstanding <= c.maxOutstanding && q.redeliveries <= c.maxRedeliveries,
          `Through second ${q.throughSecond}, ${c.resourceId}: ${q.originals} originals, ${q.deliveries} deliveries, ${q.effects} completed object effects, ${q.acknowledged} acknowledged (minimum ${c.minAcknowledged}); ${outstanding} outstanding (${q.ready} ready + ${q.inFlight} in flight + ${q.scheduled} scheduled; maximum ${c.maxOutstanding}); ${q.redeliveries} redeliveries (maximum ${c.maxRedeliveries}), ${q.deadLettered} dead-lettered, ${q.discarded} discarded, ${q.expired} expired. Effects are separate from acknowledgements.`, sources);
      }
      case "backend-admission-budget": {
        const t = this.atEvaluation, whole = t?.traffic?.wholeRun;
        const sources = ["terminalSnapshot.metrics.lbAccounting", "terminalSnapshot.traffic.wholeRun", "runInputs.resources"];
        if (!input || !t || !whole || whole.throughSecond !== t.simulatedSeconds) return pending("Cumulative caller and backend admission evidence at the evaluation second is required.", sources);
        const lbs = input.resources.filter(r => r.type === RESOURCE_TYPES.LoadBalancer);
        if (!lbs.length) return decided(false, "The captured design has no load balancer to measure.", sources);
        const counters = lbs.map(lb => t.resources.find(r => r.id === lb.id)?.lbAccounting);
        if (counters.some(a => !a || a.profile !== "lb-accounting/1")) return pending("Backend admission counters were not recorded for every captured load balancer.", sources);
        const offered = whole.completed + whole.failed + whole.deadlineExceeded + whole.abandoned + whole.inFlight;
        if (!Number.isSafeInteger(offered) || offered <= 0) return pending("A positive, safe offered caller count was not recorded; amplification is Unknown.", sources);
        const attempts = counters.reduce((sum, a) => sum + a!.acceptedByBackend + a!.rejectedByVm, 0);
        if (!Number.isSafeInteger(attempts)) return pending("The backend admission total exceeds safe counter precision.", sources);
        const ratio = attempts / offered;
        return decided(ratio <= c.maxPerOfferedRequest, `Through second ${t.simulatedSeconds}, ${attempts} backend admission attempts (accepted + VM refusals) / ${offered} offered caller requests = ${ratio.toFixed(3)}; limit ${c.maxPerOfferedRequest}. Queue counts overlap admissions. This budget does not establish sufficient capacity.`, sources);
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
        const full = dbs.filter((d) => c.requireSpare ? d.connections! >= d.limit : d.connections! > d.limit);
        return decided(!full.length, list(dbs.map((d) => c.requireSpare ? `${d.name} had ${d.connections} of ${d.limit} sessions (${d.limit - d.connections!} spare)` : `${d.name} had ${d.connections} of ${d.limit} connections`)) +
          ` at second ${t.simulatedSeconds}${c.requireSpare ? "; strictly positive spare session capacity is required" : ""}.`, ["terminalSnapshot.metrics", "terminalSnapshot.installedSkus"]);
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
      case "database-admission": {
        const sources = ["terminalSnapshot.metrics.security.edges", "runInputs.resources"];
        if (!t || !input || t.measurementFreshness !== "current-revision") return unknown("Current database admission measurements were not recorded.", sources);
        const dbs = input.resources.filter(r => r.type === RESOURCE_TYPES.Database);
        if (!dbs.length) return unknown("No captured database exists.", sources);
        const edges = [];
        for (const db of dbs) {
          const rows = t.resources.filter(r => r.id === db.id), parsed = SecurityMetricsSchema.safeParse(rows[0]?.security);
          if (rows.length !== 1 || !parsed.success) return unknown("Complete database security counters were not recorded.", sources);
          const incoming = parsed.data.edges.filter(e => e.target === db.id);
          const links = input.connectionLines.filter(e => e.targetId === db.id && input.resources.find(r => r.id === e.sourceId)?.type !== RESOURCE_TYPES.Firewall);
          const fixedSources = links.every(e => !input.resources.find(r => r.id === e.sourceId)?.autoscaling?.enabled);
          const expectedPaths = links.map(e => `${e.id}:${e.sourceId}:${db.id}`);
          if (!fixedSources || !expectedPaths.length || incoming.length !== expectedPaths.length || expectedPaths.some(path => !incoming.some(e => e.path === path))) return unknown("Complete fixed direct database paths were not retained; replica or helper coverage is Unknown.", sources);
          if (!incoming.length || incoming.some(e => e.denied === null || e.noListener === null || e.backendDeliveries === null || e.policyDenied === null)) return unknown("Incoming database counter coverage is missing; no zero is inferred.", sources);
          edges.push(...incoming);
        }
        if (new Set(edges.map(e => e.path)).size !== edges.length) return unknown("Database admission paths are duplicated.", sources);
        const denied = edges.reduce((n, e) => n + e.denied!, 0), noListener = edges.reduce((n, e) => n + e.noListener!, 0);
        const policy = edges.reduce((n, e) => n + Object.values(e.policyDenied!).reduce((a, b) => a + b, 0), 0);
        const delivered = edges.reduce((n, e) => n + e.backendDeliveries!, 0);
        if (![denied, noListener, policy, delivered].every(Number.isSafeInteger) || denied === 0 && delivered === 0) return unknown("No safe positive admission or delivery population was retained.", sources);
        const actual = denied === 0 ? "no-denials" : policy === denied ? "policy-denied" : noListener === denied ? "no-listener" : "other-or-mixed";
        const rules = edges.flatMap(e => Object.entries(e.policyDenied!).filter(([, n]) => n > 0).map(([rule, n]) => `${rule}: ${n}`));
        return compare(actual, actual === predicted, `Through second ${t.simulatedSeconds}: ${denied} database admission denials, ${noListener} missing-listener denials, ${delivered} backend deliveries. Recorded rule counters: ${rules.join("; ") || "none"}. CPU and health alone do not identify a rule. Packet traces and application correctness are not recorded.`, sources);
      }
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
  let scenario: RecordedScenario | null = null;
  let scenarioMatches = attempt.challengeScenario == null && !entry?.definition.scenario;
  if (entry?.definition.scenario && evidence.runInputs) {
    try { scenario = verifiedScenario(attempt.challengeScenario, entry.definition, evidence.runInputs); scenarioMatches = true; }
    catch { scenarioMatches = false; }
  }
  const definitionMatches = !!entry && entry.hash === attempt.challengeSpecHash &&
    entry.definition.evaluationSeconds === attempt.evaluationStopAtSimulatedSeconds && planMatches && scenarioMatches;
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
  const scenarioProblem = scenario ? scenarioEvidenceProblem(scenario, evidence) : null;
  const criteria = definition.criteria.map((c) => scenarioProblem ? {id: c.id, label: c.label,
    status: judge.active ? "pending" as const : "not-evaluated" as const, detail: scenarioProblem, sources: ["RunAction", "challengeScenario"]} : judge.criterion(c));
  // Scenarios require evidence for every requirement before static failures can
  // produce a score. Earlier challenge versions retain their original aggregation.
  let status = scenario && !judge.active && criteria.some(c => c.status === "not-evaluated")
    ? "not-evaluated" as const : overall(judge.active, criteria);
  // A resilience attempt whose fault never happened as planned has nothing to be judged against.
  if (judge.experimentMissing() && !judge.active && status !== "not-met") status = "not-evaluated";
  // New observation exercises require their later evaluation even when a static
  // requirement already failed. Preserve the earlier versions' judging behavior.
  if (definition.experiment?.postFaultObservationSeconds && !judge.active && (!judge.atEvaluation || judge.experimentMissing())) status = "not-evaluated";
  if (scenario && !judge.active && (!judge.atEvaluation || scenarioProblem)) status = "not-evaluated";
  const inspectNext: string[] = [];
  const hot = judge.atEvaluation?.resources.filter((r) => r.health === "saturated" || r.health === "failed").map((r) => r.id) ?? [];
  if (hot.length) inspectNext.push(`Open ${list(hot)} in the final-state table and follow their upstream connections.`);
  if (!judge.active && !judge.atEvaluation) inspectNext.push(`Run the attempt through to second ${definition.evaluationSeconds} so the runtime requirements can be checked.`);
  if (status === "not-met") inspectNext.push("Change one thing in the challenge design, then start a new attempt under the same workload and seed.");
  return { challengeId: definition.id, version: definition.version, title: definition.title, evaluationSeconds: definition.evaluationSeconds,
    status, statusDetail: STATUS_DETAIL[status], definitionMatches, criteria,
    metCount: criteria.filter((c) => c.status === "met").length, total: criteria.length,
    predictions: definition.predictions.map((q) => scenarioProblem ? {id: q.id, prompt: q.prompt, predicted: prediction.answers[q.id] ?? "", actual: null,
      outcome: "unknown" as const, detail: scenarioProblem, sources: ["RunAction"]} : judge.prediction(q, prediction.answers[q.id] ?? "")),
    reasoning: prediction.reasoning, predictionSubmittedAt: submittedAt, inspectNext, experiment: judge.experiment };
}

function scenarioEvidenceProblem(plan: RecordedScenario, evidence: ChallengeEvidence): string | null {
  const actions = evidence.actions ?? [], steps = orderedScenarioSteps(plan);
  if (evidence.actionCount !== actions.length) return "Scenario action evidence is missing or unreadable; this attempt is unscored.";
  const scripted = actions.filter(a => a.scenarioStepId !== undefined);
  if (scripted.length !== steps.length || actions.some(a => !a.scenarioStepId && a.kind !== "speed" && a.kind !== "teardown")) return "The recorded actions do not match the complete scenario; this attempt is unscored.";
  for (const [i, step] of steps.entries()) {
    const action = scripted[i], receipt = plan.receipts[i];
    if (plan.databaseRecovery && step.request.interventionId.startsWith("db-")) {
      const sample = action?.outcome?.databaseIncident;
      if (!sample || sample.resourceId !== plan.databaseRecovery.resourceId || sample.before.simulatedSecond !== step.atSecond ||
        sample.during?.simulatedSecond !== step.atSecond + 1 || sample.after?.simulatedSecond !== action?.completedSimulatedSeconds) {
        return `Recovery step ${step.id} is missing its retained incident boundaries; this attempt is unscored.`;
      }
    }
    if (!action || !receipt || action.scenarioStepId !== step.id || action.kind !== "intervention" || !sameScenarioValue(action.parameters, step.request) ||
      action.status !== "completed" || !action.appliedAt || !action.completedAt || action.appliedSimulatedSeconds !== step.atSecond ||
      action.completedSimulatedSeconds !== Math.ceil((receipt.endUs ?? receipt.atUs) / 1_000_000) || action.outcome?.interventionEnded !== true ||
      !sameScenarioValue(action.outcome.intervention, receipt)) return `Scenario step ${step.id} has no exact target, application and end receipt; this attempt is unscored.`;
  }
  return null;
}
