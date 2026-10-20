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
  measurement?: { uncertainty: string; fitIdentity: string; holdoutIdentity: string | null;
    conditions: string; cpuMethod: "thread-core-time" | "process-core-time" };
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
    workers: number; queue: number; listenerPort: number; cancellation: "detach" | "request-cancellation" }>;
  caller: { entry: string; port: number; transport: "plain-serial/1"; connections: number; pending: number;
    timeoutUs: number; requestBytes: number | null; responseBytes: number | null; requestLink: string; responseLink: string };
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
    activeTransactions: number; pendingQueries: number; initial: Array<{ key: string; version: number; bytes: number }>;
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
// V1 remains an authoring-only artifact. Upgrading requires a reviewed copy;
// none of these values may be inferred from a saved V1 sidecar.
export const FIRST_STACK_EXECUTION_COMPILER = "first-stack-compiler/2";
export interface FirstStackPoolPolicy {
  reuse: boolean; establishUs: number; acquireTimeoutUs: number; connectTimeoutUs: number;
  responseTimeoutUs: number; idleTimeoutUs: number | null;
  remoteCancellation: "detach" | "request-cancellation";
}
export interface FirstStackSidecarV2 extends Omit<FirstStackSidecar, "schema" | "compiler" | "links" | "paths" | "caller" | "nodes" | "balancer" | "workload" | "faults"> {
  faults: FirstStackFault[];
  retry?: { schema: "first-stack-read-retry/1"; owner: "load-balancer"; operations: string[];
    maxAttempts: 2; backoffUs: number; maxConcurrentRetries: number };
  schema: "infraforge-first-stack-sidecar/2"; compiler: "first-stack-compiler/2";
  links: Array<FirstStackSidecar["links"][number] & { from: string; to: string }>;
  paths: Array<FirstStackSidecar["paths"][number] & { pool: FirstStackPoolPolicy }>;
  caller: FirstStackSidecar["caller"] & { pool: FirstStackPoolPolicy };
  nodes: Array<FirstStackSidecar["nodes"][number] & { alive: boolean; ready: boolean }>;
  balancer: FirstStackSidecar["balancer"] & { initial: "eligible" | "ineligible"; healthTimeoutUs: number; healthKeys: string[] };
  workload: { scheduleHash: string; parametersHash: string; resolvedIdentity: string; executedScheduleHash: string } | null;
}
// Reviewed optional-cache copy. V2 remains the frozen cache-free composition.
export interface FirstStackSidecarV3 extends Omit<FirstStackSidecarV2, "schema" | "compiler" | "faults" | "retry"> {
  faults: [];
  retry?: never;
  schema: "infraforge-first-stack-sidecar/3"; compiler: "first-stack-compiler/3";
  cache: { node: string; semantics: "keyed-cache/1"; capacityBytes: number; entryOverheadBytes: number;
    ttlUs: number; commandCpuUs: number; policy: "lru" | "no-eviction";
    initial: Array<{ key: string; version: number; bytes: number }>;
    coalesce: boolean; onFailure: "fail" | "database"; invalidateWrites: true;
    // Null retains Unknown overhead; an explicit value adds to app CPU once.
    policyCpuUs: number | null;
    roles: Array<{ app: string; policy: string; internal: FirstStackSidecarV2["paths"][number]; database: FirstStackSidecarV2["paths"][number] }>;
  };
}
export type FirstStackExecutable = FirstStackSidecarV2 | FirstStackSidecarV3;
export type FirstStackSemantic = FirstStackSidecar | FirstStackExecutable;
export type FirstStackFault = { id: string; atUs: number; target: string } & (
  { kind: "app-process-crash"; schema: "first-stack-fault/1"; downtimeUs: number; recoveryUs: number } |
  { kind: "directed-delay"; schema: "first-stack-fault/1"; durationUs: number; delayUs: number } |
  { kind: "directed-partition"; schema: "first-stack-fault/1"; durationUs: number }
);
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
  profileHash: string;
  normalizedContentHash: string; executedScheduleHash: string;
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
