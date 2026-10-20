import { firstStackCompileFixture } from "./first-stack-compile";
import { hash } from "../../apps/backend/firstStack/canonical";

export async function firstStackFaultFixture(options: { shared?: boolean; write?: boolean } = {}) {
  const f = await firstStackCompileFixture(2, options);
  f.sidecar.balancer.intervalUs = 3000; f.sidecar.balancer.healthTimeoutUs = 2000;
  f.sidecar.paths.forEach(p => { p.pool.connectTimeoutUs = 1000; p.pool.acquireTimeoutUs = 2000; });
  f.sidecar.paths.filter(p => p.purpose === "routing").forEach(p => { p.timeoutUs = 2000; p.pool.responseTimeoutUs = 2000; });
  f.policy.maxRawResults = 8; f.policy.horizonUs = 24500; f.schedule.header.durationUs = 20000;
  f.schedule.rows = f.schedule.rows.slice(0, 8).map((r, i) => ({ ...r, atUs: [5000, 5400, 5800, 7000, 10000, 13000, 16000, 19000][i]! }));
  f.schedule.executedScheduleHash = hash({ header: f.schedule.header, rows: f.schedule.rows });
  const { identity: _identity, ...body } = f.schedule; f.schedule.identity = hash(body);
  f.sidecar.workload!.resolvedIdentity = f.schedule.identity; f.sidecar.workload!.executedScheduleHash = f.schedule.executedScheduleHash;
  f.sidecar.faults = [{ schema: "first-stack-fault/1", id: "app-loss", kind: "app-process-crash", target: "app-1", atUs: 5500, downtimeUs: 1500, recoveryUs: 1000 }];
  f.sidecar.retry = { schema: "first-stack-read-retry/1", owner: "load-balancer", operations: ["read"], maxAttempts: 2, backoffUs: 100, maxConcurrentRetries: 4 };
  if (options.write) delete f.sidecar.retry;
  return f;
}

