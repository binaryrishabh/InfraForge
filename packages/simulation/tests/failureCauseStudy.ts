import type { CircuitBreakerPolicy, LoadBalancer } from "../src/model2/network/contracts";
import type { RelationalConfig } from "../src/model2/data/contracts";
import type { CausalEvent } from "../src/model2/workload/causal";
import { createDataRuntime } from "../src/model2/data/run";
import { dataFixture } from "./dataFixture";
import { quantities } from "./workloadFixture";

// Like retryStudy.ts, retain only real transition events; observers never control the run.
export function policies() {
  const q = quantities("Failure cause boundary proof");
  const breaker: CircuitBreakerPolicy = { profile: "caller-circuit-breaker/1", failureThreshold: q.q("cause.threshold", 1, "count"), cooldown: q.q("cause.cooldown", 100000, "us"), maxProbes: q.q("cause.probes", 1, "count"), successfulProbesToClose: q.q("cause.successes", 1, "count") };
  const retry: LoadBalancer["retry"] = { profile: "canvas-retries/1", maxAttempts: q.q("cause.attempts", 3, "count"), backoff: q.q("cause.backoff", 10, "us"), jitter: q.q("cause.jitter", 0, "ratio"), maxConcurrentRetries: q.q("cause.budget", 100, "count"), retryOn: ["backend-rejected"], allowAmbiguousNonIdempotent: false };
  return { q, breaker, retry };
}
export const rootOf = (e: CausalEvent) => e.work?.rootId ?? e.detail.root;

export function sessionDesign(legacy = false, cause = true) {
  const input = dataFixture({ count: 8, interval: 1, slots: 64, sessions: 1, dbCpu: 1000, raw: 2000 });
  const p = policies();
  if (cause) input.failureCauseProfile = "failure-cause/1";
  input.workloadVersion = legacy ? "m2e-pg/1" : "m2e-pg/2";
  const db = input.resources.find(r => r.kind === "relational") as RelationalConfig;
  db.semantics = legacy ? "postgresql-keyed/1" : "postgresql-keyed/2";
  for (const plan of Object.values(db.plans)) for (const statement of plan.statements) statement.keys = ["k0"];
  // Direct app dependency: the test exercises the real DB session gate, not a synthetic rejection.
  input.resources = input.resources.filter(r => r.id !== "aside" && r.id !== "cache");
  const app = input.resources.find(r => r.kind === "compute")!;
  if (app.kind !== "compute") throw Error("app"); app.downstream = "db";
  input.paths = input.paths.filter(path => path.source === "$caller" || path.source === "lb" || path.source === "app");
  const dbPath = input.paths.find(path => path.source === "app")!; dbPath.target = "db";
  for (const link of input.links) { if (link.from === "aside") link.from = "db"; if (link.to === "aside") link.to = "db"; }
  const linkIds = new Set(input.paths.flatMap(path => [...path.request, ...path.response]));
  input.links = input.links.filter(link => linkIds.has(link.id));
  delete input.endpoints.aside; delete input.endpoints.cache;
  const lb = input.resources.find(r => r.kind === "load-balancer") as LoadBalancer; lb.retry = p.retry;
  input.paths.find(path => path.source === "lb")!.circuitBreaker = p.breaker;
  input.ledger.push(...p.q.ledger);
  return input;
}
export function runCauseSessionStudy(cause = true) {
  const events: CausalEvent[] = [], input = sessionDesign(false, cause);
  const run = createDataRuntime(input, { resource: () => undefined, causal: e => events.push(e) });
  run.advanceTo(run.horizon);
  return { evidence: run.evidence(), events };
}

