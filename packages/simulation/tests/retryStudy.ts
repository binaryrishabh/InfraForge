import { authorSlowQueries, configureSlowDesign, installSlowFault, isSlowStudy, isResponseStudy, type SlowStudyFailure } from "./retrySlowStudy";
import { createHash } from "node:crypto";
import type { Resource, RetrySettings } from "@infraforge/domain/resource";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import type { CausalEvent } from "../src/model2/workload/causal";
import { buildModel2Contract } from "../src/model2/product/runContract";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { withTimeline, type TimedAction } from "../src/model2/product/timeline";

export const RETRY_STUDY_SEED = "retry-study";
export const RETRY_STUDY_POLICIES: Record<"disabled" | "aggressive" | "bounded" | "deadline", RetrySettings> = {
  disabled: { enabled: false },
  aggressive: { enabled: true, maxAttempts: 5, backoffMs: 1, jitterRatio: 0.2, maxConcurrentRetries: 64, retryOn: ["backendFailure", "timeout", "connectionFailure"] },
  bounded: { enabled: true, maxAttempts: 2, backoffMs: 100, jitterRatio: 0.2, maxConcurrentRetries: 4, retryOn: ["backendFailure", "timeout", "connectionFailure"] },
  deadline: { enabled: true, maxAttempts: 5, backoffMs: 2000, jitterRatio: 0, maxConcurrentRetries: 64, retryOn: ["backendFailure", "timeout", "connectionFailure"] },
};
export type StudyPolicy = keyof typeof RETRY_STUDY_POLICIES;
export type StudyFailure = "overload" | "transient" | "control" | SlowStudyFailure;
const SECOND = 1_000_000, LOAD_FALL_US = 5 * SECOND, HORIZON_SECONDS = 8;

/** Only saved canvas fields; no hand-authored engine resources or altered demand/pool quantities. */
export function retryStudyDesign(policy: StudyPolicy, readFraction = 1): SavedProductDesign {
  const resources: Resource[] = [
    { id: "lb", type: "Load Balancer", x: 0, y: 0, retry: structuredClone(RETRY_STUDY_POLICIES[policy]) },
    ...Array.from({ length: 12 }, (_, i): Resource => ({ id: `app${i}`, type: "Virtual Machine", x: 480, y: i * 240, size: "large" })),
    { id: "db", type: "Database", x: 960, y: 0 },
  ];
  const pairs = resources.filter((r) => r.type === "Virtual Machine").flatMap((r) => [["lb", r.id], [r.id, "db"]]);
  return { schema: "infraforge-saved-design/1", resources,
    connections: pairs.map(([source, target], i) => ({ id: `e${i}`, sourceId: source!, targetId: target!, sourceType: resources.find((r) => r.id === source)!.type, targetType: resources.find((r) => r.id === target)!.type, port: target === "db" ? 5432 : 80 })),
    workload: { targetThroughput: 12000, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: readFraction, payloadSize: "light" } };
}

export function retryStudyActions(failure: StudyFailure): TimedAction[] {
  return [
    ...(failure === "overload" ? [{ id: "surge", kind: "load" as const, atUs: SECOND, fraction: 10 }] : []),
    // Existing product crash action: 200 ms unavailable plus an explicit 1 s process restart.
    ...(failure === "transient" ? [{ id: "blip", kind: "crash" as const, node: "app0", atUs: 1_005_000, durationUs: 200_000, restartUs: SECOND }] : []),
    { id: "stop", kind: "load", atUs: LOAD_FALL_US, fraction: 0 },
  ];
}

type Balancer = ReturnType<ReturnType<typeof createProductModel2>["evidence"]>["network"]["loadBalancers"][number];
type Database = { queued: number; serving: number; waiting: number; sessions: number; orphaned: number };
const rootOf = (event: CausalEvent) => event.work?.rootId ?? (typeof event.detail.root === "string" ? event.detail.root : undefined);

export function runRetryStudy(failure: StudyFailure, policy: StudyPolicy, readFraction = 1) {
  const design = retryStudyDesign(policy, readFraction), slow = isSlowStudy(failure);
  if (slow) configureSlowDesign(design, failure);
  const horizonSeconds = slow ? 12 : HORIZON_SECONDS;
  const built = buildModel2Contract(design, horizonSeconds, RETRY_STUDY_SEED);
  if ("refused" in built) throw Error(built.refused.join("; "));
  const contract = withTimeline({ ...built.contract, arrival: { ...built.contract.arrival, generated: true } }, retryStudyActions(failure));
  if (slow) authorSlowQueries(contract, failure);
  const compiled = compileProduct(design, contract);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  if (slow) installSlowFault(compiled.value, contract, failure);
  const callers = new Map<string, { offeredAt: number; operation: string }>();
  const retriesByRoot = new Map<string, number>(), ambiguousWrites = new Set<string>();
  const dbAdmissionsByRoot = new Map<string, number>(), dbLiveByRoot = new Map<string, number>(), callerStopped = new Set<string>();
  let maxConcurrentDbCopies = 0, overlappingDbAdmissions = 0, lateDbTerminals = 0, lateDbCommits = 0;
  let lastNonemptyQueueSampleUs: number | null = null;
  const chains = new Map<string, CausalEvent[]>();
  let chainRoot: string | undefined, chain: CausalEvent[] = [], run: ReturnType<typeof createProductModel2> | undefined;
  let peakWaiting = 0, peakExecuting = 0, peakBudget = 0, peakSessions = 0, peakOrphans = 0, peakDbQueued = 0;
  let lastForegroundDbTerminalUs = 0, lateRetrySchedules = 0, lateRetryLaunches = 0;
  let observedSchedules = 0, observedSuppressions = 0, retainedChainEvents = 0;
  const sample = () => {
    const lb = run?.inspect("lb") as Balancer | undefined, db = run?.inspect("db") as Database | undefined;
    if (lb) { peakWaiting = Math.max(peakWaiting, lb.retriesWaiting ?? 0); peakExecuting = Math.max(peakExecuting, lb.activeRetries); peakBudget = Math.max(peakBudget, (lb.retriesWaiting ?? 0) + lb.activeRetries); }
    if (db) { peakSessions = Math.max(peakSessions, db.sessions); peakOrphans = Math.max(peakOrphans, db.orphaned); peakDbQueued = Math.max(peakDbQueued, db.queued); }
  };
  const observe = (event: CausalEvent) => {
    const root = rootOf(event);
    if (event.kind === "caller-offered" && root) callers.set(root, { offeredAt: event.atUs, operation: event.work!.operation });
    if (root && event.kind === "caller-terminal") {
      callerStopped.add(root);
      if (slow && isResponseStudy(failure) && event.detail.outcome === "rejected" && chainRoot === undefined) {
        chainRoot = root; chain = chains.get(root) ?? []; retainedChainEvents = chain.length; chains.clear();
      }
    }
    if (root && callers.has(root) && event.kind === "db-admitted") {
      const live = (dbLiveByRoot.get(root) ?? 0) + 1;
      if (live > 1) overlappingDbAdmissions++;
      maxConcurrentDbCopies = Math.max(maxConcurrentDbCopies, live); dbLiveByRoot.set(root, live);
      dbAdmissionsByRoot.set(root, (dbAdmissionsByRoot.get(root) ?? 0) + 1);
    }
    if (root && callers.has(root) && event.kind === "db-terminal") {
      dbLiveByRoot.set(root, (dbLiveByRoot.get(root) ?? 0) - 1);
      if (callerStopped.has(root)) { lateDbTerminals++; if (event.detail.outcome === "committed") lateDbCommits++; }
    }
    if (event.kind === "db-terminal" && event.work?.operation !== "health") lastForegroundDbTerminalUs = event.atUs;
    if (["lb-selected", "retry-scheduled", "retry-suppressed", "db-admitted", "db-terminal", "db-session-open"].includes(event.kind)) sample();
    if (event.kind === "retry-scheduled" && root) {
      observedSchedules++;
      const caller = callers.get(root)!;
      const delayUs = Number(String(event.detail.detail).split(":")[1]!.replace("us", ""));
      if (event.atUs + delayUs >= caller.offeredAt + 5 * SECOND) lateRetrySchedules++;
      if (chainRoot === undefined) { chainRoot = root; chain = chains.get(root) ?? []; retainedChainEvents = chain.length; chains.clear(); }
    }
    if (event.kind === "lb-selected" && root) {
      const count = retriesByRoot.get(root) ?? 0;
      if (count && event.atUs >= callers.get(root)!.offeredAt + 5 * SECOND) lateRetryLaunches++;
      retriesByRoot.set(root, count + 1);
    }
    if (event.kind === "retry-suppressed") {
      observedSuppressions++;
      if (root && event.detail.detail === "ambiguous-write") ambiguousWrites.add(root);
    }
    if (!root) return;
    if (root === chainRoot) { if (chain.length < 128) chain.push(event); retainedChainEvents++; }
    else if (chainRoot === undefined && callers.has(root)) {
      // Bounded temporary index to retain the pre-failure history of the first retried request.
      if (chains.size >= 1000 && !chains.has(root)) chains.delete(chains.keys().next().value!);
      const rows = chains.get(root) ?? []; if (rows.length < 128) rows.push(event); chains.set(root, rows);
    }
  };
  run = createProductModel2(compiled.value, undefined, observe);
  const samples = [];
  for (let second = 1; second <= horizonSeconds; second++) {
    if (slow && second >= 5) {
      // Last nonempty queue on a 1 ms grid, including any retry-driven refill after offered load falls.
      for (let atUs = Math.max(LOAD_FALL_US, (second - 1) * SECOND + 1000); atUs <= second * SECOND; atUs += 1000) {
        run.advanceTo(atUs); sample();
        if ((run.inspect("db") as Database).queued > 0) lastNonemptyQueueSampleUs = atUs;
      }
    } else { run.advanceTo(second * SECOND); sample(); }
    const db = run.inspect("db") as Database, lb = run.inspect("lb") as Balancer;
    samples.push({ second, dbQueued: db.queued, dbServing: db.serving, dbWaiting: db.waiting, sessions: db.sessions, orphans: db.orphaned,
      retriesWaiting: lb.retriesWaiting ?? null, activeRetries: lb.activeRetries });
  }
  const evidence = run.evidence(), lb = evidence.network.loadBalancers[0]!, db = evidence.data.databases[0]!;
  const dbPaths = evidence.network.paths.filter((p) => p.target === "db");
  const pathReason = (reason: string) => dbPaths.reduce((sum, p) => sum + (p.reasons[reason] ?? 0), 0);
  const summary = { failure, policy, readFraction, originalRequests: evidence.counts.offered, attempts: lb.attempts, retries: lb.retries,
    retriesWaiting: lb.retriesWaiting ?? null, peakRetriesWaiting: policy === "disabled" ? null : peakWaiting, peakExecuting, peakBudget,
    suppressed: lb.suppressedByReason ?? null, caller: evidence.counts,
    databaseCalls: dbPaths.reduce((sum, p) => sum + p.offered, 0), databaseAdmitted: db.transactions.admitted, databaseCommitted: db.transactions.committed,
    databaseCpuUs: db.cpu.appCoreUs, databaseAborted: db.transactions.aborted, databaseCancelled: db.transactions.cancelled, databaseReasons: db.reasons,
    maxConcurrentDbCopies, overlappingDbAdmissions, repeatedDbAdmissions: [...dbAdmissionsByRoot.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    lateDbTerminals, lateDbCommits,
    queueDrainAfterLoadFallUs: slow ? (lastNonemptyQueueSampleUs === null ? 0 : lastNonemptyQueueSampleUs + 1000 - LOAD_FALL_US) : null,
    queueDrainResolutionUs: slow ? 1000 : null,
    remoteAfterStop: evidence.network.paths.reduce((sum, p) => sum + p.remoteOutcomesAfterStop, 0),
    dbRemoteAfterStop: dbPaths.reduce((sum, p) => sum + p.remoteOutcomesAfterStop, 0),
    lbRemoteAfterStop: evidence.network.paths.filter((p) => p.source === "lb").reduce((sum, p) => sum + p.remoteOutcomesAfterStop, 0),
    responseTimeouts: evidence.network.paths.reduce((sum, p) => sum + (p.reasons["response-timeout"] ?? 0), 0),
    callerResponseTimeouts: evidence.network.paths.filter((p) => p.source === "$caller").reduce((sum, p) => sum + (p.reasons["response-timeout"] ?? 0), 0),
    lbResponseTimeouts: evidence.network.paths.filter((p) => p.source === "lb").reduce((sum, p) => sum + (p.reasons["response-timeout"] ?? 0), 0),
    databaseLive: db.transactions.live, databaseQueued: db.queued, peakDbQueued, databaseClasses: db.queryClasses,
    sessions: db.sessions, peakSessions, peakOrphans, sessionRefusals: db.sessionEvents!.refused,
    poolPending: dbPaths.reduce((sum, p) => sum + p.pool.pending, 0), poolWaitUs: dbPaths.reduce((sum, p) => sum + p.completedPhaseDurationsUs.connectionWaitUs, 0),
    poolAcquireTimeouts: pathReason("acquire-timeout"), poolResponseTimeouts: pathReason("response-timeout"), poolOverflow: pathReason("pool-overflow"),
    drainAfterLoadFallUs: Math.max(0, lastForegroundDbTerminalUs - LOAD_FALL_US),
    lateRetrySchedules, lateRetryLaunches, observedSchedules, observedSuppressions,
    ambiguousWrites: ambiguousWrites.size, ambiguousWriteRetries: [...ambiguousWrites].filter((root) => (retriesByRoot.get(root) ?? 0) > 1).length,
    traceRetained: evidence.network.trace.retained, traceOmitted: evidence.network.trace.omitted,
    chainRoot: chainRoot ?? null, chainRetained: chain.length, chainOmitted: Math.max(0, retainedChainEvents - chain.length),
    evidenceHash: createHash("sha256").update(JSON.stringify(evidence).replaceAll("\r\n", "\n")).digest("hex") };
  return { summary, samples, chain, compiled: compiled.value, evidence };
}

if (import.meta.main) {
  const failure = (process.argv[2] ?? "overload") as StudyFailure;
  const policies = process.argv.slice(3) as StudyPolicy[];
  for (const policy of policies.length ? policies : ["disabled", "aggressive", "bounded"] as const) {
    const { summary, chain } = runRetryStudy(failure, policy);
    console.log(JSON.stringify({ summary, chain: chain.filter((r) => ["caller-offered", "lb-received", "lb-selected", "attempt-terminal", "retry-scheduled", "retry-suppressed", "caller-terminal"].includes(r.kind)) }));
  }
}
