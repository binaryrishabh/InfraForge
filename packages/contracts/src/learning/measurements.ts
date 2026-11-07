/** Labels audited against the existing saved-report renderers. Qualifiers keep
 * terminal-second, whole-run and resource populations distinct. The authoring
 * tests check each source marker so this list cannot silently outlive its UI. */
interface Measurement {
  scope: "traffic" | "resource" | "monthly" | "snapshot";
  path: string;
  unit?: string;
  resourceType?: string;
  source: string;
  marker: string;
}
const trafficSource = "apps/web/src/features/live/TrafficEvidence.tsx";
const resourceSource = "apps/web/src/features/reports/components/ReportMeasurements.tsx";
const wholeSource = "apps/web/src/features/live/WholeRunReadings.tsx";
const replicationSource = "apps/web/src/features/live/DatabaseReplicationReadings.tsx";
const securitySource = "apps/web/src/features/canvas/components/inspector/SecuritySection.tsx";
const lbSource = "apps/web/src/features/reports/components/LbAccountingReadings.tsx";
const queueSource = "apps/backend/challenges/evaluate.ts";
const gatewaySource = "apps/web/src/features/live/GatewayReadings.tsx";
const schedulerSource = "apps/web/src/features/live/SchedulerReadings.tsx";
const functionSource = "apps/web/src/features/live/ServerlessReadings.tsx";
const actionSource = "apps/web/src/features/reports/components/ActionTimeline.tsx";
const dataSource = "apps/web/src/features/live/DataDeliveryReadings.tsx";

// vmMemory.resources.* retains residentBytes, limitBytes, headroomBytes,
// holdingRequests, activeRequests, allocationRejected and peakResidentBytes.
// VmMemoryReadings renders them only on the live canvas, not in ReportMeasurements.
// None is an audited saved-report label until that report actually renders it.

export const LEARNING_REPORT_MEASUREMENTS = {
  "Acknowledged messages": { scope: "resource", path: "queueWork.acknowledged", resourceType: "Message Queue", source: "apps/web/src/features/reports/components/QueueReadings.tsx", marker: '"Acknowledged messages"' },
  "Expired messages": { scope: "resource", path: "queueWork.expired", resourceType: "Message Queue", source: "apps/web/src/features/reports/components/QueueReadings.tsx", marker: '"Expired messages"' },
  "Ready messages": { scope: "resource", path: "asyncQueue.readyDepth", resourceType: "Message Queue", source: "apps/web/src/features/reports/components/QueueReadings.tsx", marker: '"Ready messages"' },
  "Oldest ready message age (seconds)": { scope: "resource", path: "asyncQueue.oldestReadyAgeSeconds", unit: "s", resourceType: "Message Queue", source: "apps/web/src/features/reports/components/QueueReadings.tsx", marker: '"Oldest ready message age (seconds)"' },
  "Offered requests/s": { scope: "traffic", path: "offeredRps", source: trafficSource, marker: "Offered requests/s" },
  "Completed requests/s": { scope: "traffic", path: "completedRps", source: trafficSource, marker: "Completed requests/s" },
  "Failed requests/s": { scope: "traffic", path: "failedRps", source: trafficSource, marker: "Failed requests/s" },
  p50: { scope: "traffic", path: "latencyMs.p50", unit: "ms", source: trafficSource, marker: '"p50"' },
  p95: { scope: "traffic", path: "latencyMs.p95", unit: "ms", source: trafficSource, marker: '"p95"' },
  CPU: { scope: "resource", path: "cpu", unit: "%", source: resourceSource, marker: '"CPU"' },
  "Overall health": { scope: "snapshot", path: "health", source: resourceSource, marker: "Overall health" },
  "Requests/s": { scope: "resource", path: "rps", source: resourceSource, marker: '"Requests/s"' },
  Health: { scope: "resource", path: "health", source: resourceSource, marker: '"Health"' },
  Connections: { scope: "resource", path: "connections", source: resourceSource, marker: '"Connections"' },
  "Whole run: Completed": { scope: "traffic", path: "wholeRun.completed", source: wholeSource, marker: '"Completed"' },
  "Whole run: Failed": { scope: "traffic", path: "wholeRun.failed", source: wholeSource, marker: '"Failed"' },
  "Whole run: In-flight": { scope: "traffic", path: "wholeRun.inFlight", source: wholeSource, marker: '"In-flight"' },
  "Deadline exceeded": { scope: "traffic", path: "wholeRun.deadlineExceeded", source: wholeSource, marker: '"Deadline exceeded"' },
  Abandoned: { scope: "traffic", path: "wholeRun.abandoned", source: wholeSource, marker: '"Abandoned"' },
  "Whole run: p95 bucket": { scope: "traffic", path: "wholeRun.percentiles.p95", source: wholeSource, marker: "w.percentiles[p].highMs" },
  "Monthly estimate (CostEstimate gate)": { scope: "monthly", path: "monthlyEstimateUsd", unit: "USD", source: resourceSource, marker: "Monthly estimate (CostEstimate gate)" },
  "Queue: originals": { scope: "resource", path: "queueWork.originals", resourceType: "Message Queue", source: queueSource, marker: "${q.originals} originals" },
  "Queue: deliveries": { scope: "resource", path: "queueWork.deliveries", resourceType: "Message Queue", source: queueSource, marker: "${q.deliveries} deliveries" },
  "Queue: completed object effects": { scope: "resource", path: "queueWork.effects", resourceType: "Message Queue", source: queueSource, marker: "${q.effects} completed object effects" },
  "Queue: acknowledged": { scope: "resource", path: "queueWork.acknowledged", resourceType: "Message Queue", source: queueSource, marker: "${q.acknowledged} acknowledged" },
  "Queue: ready": { scope: "resource", path: "queueWork.ready", resourceType: "Message Queue", source: queueSource, marker: "${q.ready} ready" },
  "Queue: in flight": { scope: "resource", path: "queueWork.inFlight", resourceType: "Message Queue", source: queueSource, marker: "${q.inFlight} in flight" },
  "Queue: scheduled": { scope: "resource", path: "queueWork.scheduled", resourceType: "Message Queue", source: queueSource, marker: "${q.scheduled} scheduled" },
  "Queue: redeliveries": { scope: "resource", path: "queueWork.redeliveries", resourceType: "Message Queue", source: queueSource, marker: "${q.redeliveries} redeliveries" },
  "Queue: dead-lettered": { scope: "resource", path: "queueWork.deadLettered", resourceType: "Message Queue", source: queueSource, marker: "${q.deadLettered} dead-lettered" },
  "Primary reads": { scope: "resource", path: "databaseReplication.primaryReads", resourceType: "Database", source: replicationSource, marker: '"Primary reads"' },
  "Replica reads": { scope: "resource", path: "databaseReplication.replicaReads", resourceType: "Database", source: replicationSource, marker: '"Replica reads"' },
  "Primary committed writes": { scope: "resource", path: "databaseReplication.primaryCommittedWrites", resourceType: "Database", source: replicationSource, marker: '"Primary committed writes"' },
  "Promoted writer commits": { scope: "resource", path: "databaseReplication.replicaCommittedWrites", resourceType: "Database", source: replicationSource, marker: '"Promoted writer commits"' },
  "Pending replication": { scope: "resource", path: "databaseReplication.pendingReplication", resourceType: "Database", source: replicationSource, marker: '"Pending replication"' },
  "Stale reads": { scope: "resource", path: "database.readRouting.staleReads", resourceType: "Database", source: replicationSource, marker: "Stale reads:" },
  "Oldest missed commit age at read": { scope: "resource", path: "database.readRouting.maxStaleReadAgeMs", unit: "ms", resourceType: "Database", source: replicationSource, marker: "oldest missed commit age at read:" },
  "Primary CPU core-us": { scope: "resource", path: "database.readRouting.members.primary.consumedCoreUs", resourceType: "Database", source: replicationSource, marker: "m.consumedCoreUs" },
  "Replica CPU core-us": { scope: "resource", path: "database.readRouting.members.replica.consumedCoreUs", resourceType: "Database", source: replicationSource, marker: "m.consumedCoreUs" },
  "Refused session opens": { scope: "resource", path: "database.sessionRefused", resourceType: "Database", source: "apps/web/src/features/live/DataDeliveryReadings.tsx", marker: '"Refused session opens"' },
  "Queued queries": { scope: "resource", path: "database.queued", resourceType: "Database", source: dataSource, marker: '"Queued queries"' },
  "Serving queries": { scope: "resource", path: "database.serving", resourceType: "Database", source: dataSource, marker: '"Serving queries"' },
  "Queries waiting for locks": { scope: "resource", path: "database.waiting", resourceType: "Database", source: dataSource, marker: '"Queries waiting for locks"' },
  "Connection acquisition wait": { scope: "traffic", path: "latency.typical.categories.connectionWait.meanMs", unit: "ms", source: "apps/web/src/features/live/LatencyBreakdown.tsx", marker: '"Connection acquisition wait"' },
  "Resolved targets:": { scope: "snapshot", path: "actions.*.outcome.intervention.resolvedTargets", source: actionSource, marker: "Resolved targets:" },
  "Applies at": { scope: "snapshot", path: "actions.*.outcome.intervention.atUs", unit: "us", source: actionSource, marker: "Applies at" },
  "baseline restore at": { scope: "snapshot", path: "actions.*.outcome.intervention.endUs", unit: "us", source: actionSource, marker: "baseline restore at" },
  "Admitted by backend (attempts)": { scope: "resource", path: "lbAccounting.acceptedByBackend", resourceType: "Load Balancer", source: lbSource, marker: '"Admitted by backend (attempts)"' },
  "Queued at VM (attempts)": { scope: "resource", path: "lbAccounting.queuedAtVm", resourceType: "Load Balancer", source: lbSource, marker: '"Queued at VM (attempts)"' },
  "Refused by VM (attempts)": { scope: "resource", path: "lbAccounting.rejectedByVm", resourceType: "Load Balancer", source: lbSource, marker: '"Refused by VM (attempts)"' },
  "Current flow occupancy": { scope: "resource", path: "security.firewall.occupancy", resourceType: "Firewall", source: securitySource, marker: '"Current flow occupancy"' },
  "Configured flow limit": { scope: "resource", path: "security.firewall.limit", resourceType: "Firewall", source: securitySource, marker: '"Configured flow limit"' },
  "Tracked state admissions": { scope: "resource", path: "security.firewall.admissions", resourceType: "Firewall", source: securitySource, marker: '"Tracked state admissions"' },
  "Policy denied new admissions": { scope: "resource", path: "security.firewall.policyDenied", resourceType: "Firewall", source: securitySource, marker: '"Policy denied new admissions"' },
  "Flow capacity refusals": { scope: "resource", path: "security.firewall.flow-capacity", resourceType: "Firewall", source: securitySource, marker: '"Flow capacity refusals"' },
  "Expired flow entries": { scope: "resource", path: "security.firewall.expired", resourceType: "Firewall", source: securitySource, marker: '"Expired flow entries"' },
  "Denied admissions": { scope: "resource", path: "security.edges.*.denied", resourceType: "Database", source: "apps/web/src/features/canvas/components/inspector/SecuritySection.tsx", marker: "text(e.denied)" },
  "No listener": { scope: "resource", path: "security.edges.*.noListener", resourceType: "Database", source: "apps/web/src/features/canvas/components/inspector/SecuritySection.tsx", marker: "text(e.noListener)" },
  "Backend deliveries": { scope: "resource", path: "security.edges.*.backendDeliveries", resourceType: "Database", source: "apps/web/src/features/canvas/components/inspector/SecuritySection.tsx", marker: "text(e.backendDeliveries)" },
  "Denied by rule": { scope: "resource", path: "security.edges.*.policyDenied.*", resourceType: "Database", source: "apps/web/src/features/canvas/components/inspector/SecuritySection.tsx", marker: "Denied by {rule}:" },
  "Published events": { scope: "resource", path: "eventBus.accepted", resourceType: "Event Bus", source: "apps/web/src/features/live/EventBusReadings.tsx", marker: "Published events:" },
  "Delivered to queue": { scope: "resource", path: "eventBus.subscriptions.*.delivered", resourceType: "Event Bus", source: "apps/web/src/features/live/EventBusReadings.tsx", marker: "Delivered to queue" },
  "Retries": { scope: "resource", path: "eventBus.subscriptions.*.retried", resourceType: "Event Bus", source: "apps/web/src/features/live/EventBusReadings.tsx", marker: "Retries" },
  "Failed attempts": { scope: "resource", path: "eventBus.subscriptions.*.deliveryAccounting.failedAttempts", resourceType: "Event Bus", source: "apps/web/src/features/live/EventBusReadings.tsx", marker: "Failed attempts" },
  "Exhausted deliveries": { scope: "resource", path: "eventBus.subscriptions.*.deliveryAccounting.exhausted", resourceType: "Event Bus", source: "apps/web/src/features/live/EventBusReadings.tsx", marker: "Exhausted deliveries" },
  "Route throttles (429)": { scope: "resource", path: "gateway.throttled", resourceType: "API Gateway", source: gatewaySource, marker: "Route throttles (429)" },
  "Capacity refusals (503)": { scope: "resource", path: "gateway.overloaded", resourceType: "API Gateway", source: gatewaySource, marker: "Capacity refusals (503)" },
  "Gateway failures (503)": { scope: "resource", path: "gateway.gatewayFailed", resourceType: "API Gateway", source: gatewaySource, marker: "Gateway failures (503)" },
  "Upstream failures (502)": { scope: "resource", path: "gateway.upstreamFailed", resourceType: "API Gateway", source: gatewaySource, marker: "Upstream failures (502)" },
  "Due triggers": { scope: "resource", path: "scheduler.due", resourceType: "Scheduler", source: schedulerSource, marker: "Due triggers" },
  "Attempts fired": { scope: "resource", path: "scheduler.fired", resourceType: "Scheduler", source: schedulerSource, marker: "Attempts fired" },
  "Completed invocations": { scope: "resource", path: "scheduler.completed", resourceType: "Scheduler", source: schedulerSource, marker: "Completed invocations" },
  "Skipped overlap": { scope: "resource", path: "scheduler.skippedOverlap", resourceType: "Scheduler", source: schedulerSource, marker: "Skipped overlap" },
  "Missed triggers": { scope: "resource", path: "scheduler.missed", resourceType: "Scheduler", source: schedulerSource, marker: "Missed triggers" },
  "Failed invocations": { scope: "resource", path: "scheduler.failed", resourceType: "Scheduler", source: schedulerSource, marker: "Failed invocations" },
  "Active invocations": { scope: "resource", path: "scheduler.active", resourceType: "Scheduler", source: schedulerSource, marker: "Active invocations" },
  "Waiting invocations": { scope: "resource", path: "scheduler.queued", resourceType: "Scheduler", source: schedulerSource, marker: "Waiting invocations" },
  "Delayed original starts": { scope: "resource", path: "scheduler.attemptAccounting.delayedStarts", resourceType: "Scheduler", source: schedulerSource, marker: "Delayed original starts" },
  "Maximum original start delay (us)": { scope: "resource", path: "scheduler.attemptAccounting.maxStartDelayUs", resourceType: "Scheduler", source: schedulerSource, marker: "Maximum original start delay (us)" },
  "Cold starts": { scope: "resource", path: "serverless.coldStarts", resourceType: "Serverless Function", source: functionSource, marker: "Cold starts" },
  "Warm starts": { scope: "resource", path: "serverless.warmStarts", resourceType: "Serverless Function", source: functionSource, marker: "Warm starts" },
  "Throttled invocations": { scope: "resource", path: "serverless.throttled", resourceType: "Serverless Function", source: functionSource, marker: "Throttled invocations" },
  "Peak instances": { scope: "resource", path: "serverless.peakInstances", resourceType: "Serverless Function", source: functionSource, marker: "Peak instances" },
  "Database calls": { scope: "resource", path: "serverless.downstreamCalls", resourceType: "Serverless Function", source: functionSource, marker: "Database calls" },
  "Database wait time (us)": { scope: "resource", path: "serverless.lifecycle.downstreamUs", resourceType: "Serverless Function", source: functionSource, marker: "Database wait time (us)" },
} satisfies Record<string, Measurement>;

export type LearningMeasurementLabel = keyof typeof LEARNING_REPORT_MEASUREMENTS;
export function learningMeasurement(label: string): Measurement | null {
  return Object.hasOwn(LEARNING_REPORT_MEASUREMENTS, label)
    ? LEARNING_REPORT_MEASUREMENTS[label as LearningMeasurementLabel] : null;
}

/** Semicolons combine named measurements in a single short evidence item. */
export const evidenceLabels = (item: string) => item.split(";").map(label => label.trim());
