// Authoring/review only. This contract grants neither execution nor activation.
export const FIRST_STACK_PROFILE = "first-stack/1";
export const FIRST_STACK_COMPILER = "first-stack-authoring/1";
export const firstStackClaims = Object.freeze({
  timing: "assumption-only", counting: "supported-logical", fullMemory: "Unknown",
  fullCost: "Unknown", execution: "unavailable", activeEngine: "1",
} as const);
export const firstStackLimits = Object.freeze({
  apps: 8, operations: 32, scheduleBytes: 8 * 1024 * 1024, lineBytes: 16 * 1024,
  rows: 20_000, semanticBytes: 16 * 1024 * 1024, parameterBytes: 2 * 1024 * 1024,
  keys: 10_000, keyBytes: 256, durationUs: 300_000_000,
});
export const firstStackScopeExamples = [1, 2, 8].flatMap(apps => [
  { apps, loadBalancers: 1, databases: 1, cache: false, review: "cache-free" },
  { apps, loadBalancers: 1, databases: 1, cache: true, review: "cache-bridge-deferred" },
]);
export interface FirstStackSource {
  id: string; version: string; origin: "authored" | "measured";
  workloadDomain: string; runtime: string; hardware: string; sources: string[];
}
export interface FirstStackOperation {
  id: string; kind: "cpu-control" | "point-read" | "range-read" | "update" | "hot-update" | "cache-read" | "health-read";
  plan: string; deadlineUs: number; requestBytes: number | null; responseBytes: number | null;
  cpuUs: number; parallelism: number; blockingUs: number; residentBytes: number | null;
}
export interface FirstStackSidecar {
  schema: "infraforge-first-stack-sidecar/1"; profile: "first-stack/1"; compiler: "first-stack-authoring/1";
  designRevision: string; application: FirstStackSource; operations: FirstStackOperation[];
  nodes: Array<{ id: string; owner: "load-balancer" | "compute" | "relational" | "keyed-cache";
    host: string; cores: number; memoryBytes: number | null; reservationBytes: number | null;
    workers: number; queue: number; cancellation: "detach" | "request-cancellation" }>;
  paths: Array<{ id: string; source: string; target: string; purpose: "routing" | "dependency";
    port: number; transport: "plain-serial/1"; connections: number; pending: number;
    timeoutUs: number; requestBytes: number | null; responseBytes: number | null;
    requestLink: string; responseLink: string }>;
  links: Array<{ id: string; bytesPerSecond: number; latencyUs: number; queueBytes: number }>;
  placement: Array<{ id: string; cores: number; memoryBytes: number | null }>;
  balancer: { policy: "round-robin" | "least-outstanding"; outstanding: number; pending: number;
    timeoutUs: number; healthOperation: string; intervalUs: number; healthy: number; unhealthy: number;
    allUnhealthy: "reject" };
  database: { semantics: "read-committed-keyed/1"; keys: string[]; maxSessions: number;
    activeTransactions: number; pendingQueries: number;
    plans: Array<{ id: string; kind: "read" | "write"; keys: "recorded" | string[];
      cpuUs: number; parallelism: number; blockingUs: number; logBytes: number;
      statementTimeoutUs: number; lockTimeoutUs: number; transactionTimeoutUs: number;
      commitWaitUs: number; durability: "logical-only" | "authored-log-ack" }> };
  workload: { scheduleHash: string; parametersHash: string } | null;
  faults: []; metrics: "first-stack-metrics/1"; retention: "first-stack-bounded/1";
  sources: string[];
  migration?: { kind: "reviewed-copy"; fromInfrastructureId: string; fromRevision: string; reviewedBy: string };
}
export interface FirstStackDiagnostic { code: string; path: string; message: string }
export interface RecordedScheduleHeader {
  schema: "infraforge-first-stack-schedule/1"; unit: "us"; durationUs: number;
  origin: "observed-recording" | "authored-schedule"; provenance: string;
}
export interface RecordedScheduleRow {
  id: string; atUs: number; operation: string;
  requestBytes?: number; responseBytes?: number; deadlineUs?: number;
  intendedAtUs?: number; sentAtUs?: number; generatorLost?: boolean;
}
export interface RecordedParameters {
  schema: "infraforge-first-stack-parameters/1";
  rows: Array<{ id: string; plan: string; keys: string[]; responseBytes?: number }>;
}
export interface ScheduleTransform {
  schema: "infraforge-first-stack-transform/1";
  timeScale: { numerator: number; denominator: number }; shiftUs: number;
}
export interface ResolvedSchedule {
  schema: "infraforge-first-stack-resolved/1"; header: RecordedScheduleHeader;
  transform: ScheduleTransform; scheduleHash: string; parametersHash: string; identity: string;
  application: FirstStackSource; rows: Array<RecordedScheduleRow & {
    plan: string; keys: string[]; requestBytes: number; responseBytes: number; deadlineUs: number;
  }>;
  unknown: string[];
}
// Every saved legacy field has a disposition. Catchall data is preserved/refused.
export const firstStackFieldDisposition = {
  id: "owner", type: "owner", x: "metadata-only", y: "metadata-only", name: "metadata-only",
  skuId: "metadata-only", region: "metadata-only", size: "metadata-only",
  autoscaling: "refused-if-configured", public: "refused-if-configured", encryption: "refused-if-configured",
  openPorts: "refused-if-configured", sourceId: "owner", targetId: "owner", port: "owner",
  sourceType: "owner", targetType: "owner", layoutVersion: "metadata-only", catchall: "refused-if-configured",
} as const;
