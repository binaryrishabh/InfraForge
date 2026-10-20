import type { FirstStackSidecarV2 } from "../../packages/contracts/src/first-stack";
import { firstStackFixture } from "../../apps/backend/tests/firstStackFixture";
import { resolveWorkload } from "../../apps/backend/firstStack/workload";
import { prepareFirstStackExecution } from "../../apps/backend/firstStack/execution";

export async function firstStackCompileFixture(apps = 2, options: { shared?: boolean; write?: boolean; range?: boolean } = {}) {
  const fixture = firstStackFixture(apps), old = fixture.sidecar;
  const pool = { reuse: true, establishUs: 2, acquireTimeoutUs: 90000, connectTimeoutUs: 90000, responseTimeoutUs: 90000, idleTimeoutUs: null, remoteCancellation: "detach" as const };
  const sidecar: FirstStackSidecarV2 = { ...old, schema: "infraforge-first-stack-sidecar/2", compiler: "first-stack-compiler/2", workload: null,
    nodes: old.nodes.map(n => ({ ...n, host: options.shared && n.owner === "compute" ? "shared-apps" : n.host,
      alive: true, ready: true, memoryBytes: null, reservationBytes: n.owner === "load-balancer" ? 0 : 100,
      workers: 32, queue: 64 })),
    placement: [...old.placement.filter(h => !options.shared || !h.id.startsWith("host-app")), ...(options.shared ? [{ id: "shared-apps", cores: 1, memoryBytes: apps * 100 }] : [])].map(h => ({ ...h, memoryBytes: h.id === "shared-apps" ? apps * 100 : 1024 })),
    caller: { ...old.caller, timeoutUs: 90000, connections: 64, pending: 64, pool: { ...pool } },
    paths: old.paths.map(p => ({ ...p, timeoutUs: 90000, connections: 32, pending: 64, pool: { ...pool } })), links: [],
    operations: old.operations.map(op => ({ ...op, deadlineUs: 90000, cpuUs: op.id === "health" ? 10 : 400,
      ...(options.write && op.id === "read" ? { kind: "hot-update" as const, plan: "write-plan" } : {}),
      ...(options.range && op.id === "read" ? { kind: "range-read" as const } : {}) })),
    balancer: { ...old.balancer, outstanding: 64, pending: 64, timeoutUs: 90000, intervalUs: 100000,
      initial: "ineligible", healthTimeoutUs: 90000, healthKeys: ["cold"] },
    database: { ...old.database, maxSessions: 256, activeTransactions: 32, pendingQueries: 64,
      plans: old.database.plans.map(p => ({ ...p, cpuUs: 200, statementTimeoutUs: 90000, lockTimeoutUs: 90000, transactionTimeoutUs: 90000 })) },
  };
  if (options.write) sidecar.database.plans.push({ ...sidecar.database.plans[0]!, id: "write-plan", kind: "write", logBytes: 8 });
  for (const p of [{ ...sidecar.caller, id: "caller", source: "$caller", target: "lb" }, ...sidecar.paths]) {
    p.requestLink = `${p.id}:req`; p.responseLink = `${p.id}:res`;
    if (p.id === "caller") { sidecar.caller.requestLink = p.requestLink; sidecar.caller.responseLink = p.responseLink; }
    sidecar.links.push({ id: p.requestLink, from: p.source, to: p.target, bytesPerSecond: 1000000000, latencyUs: 1, queueBytes: 100000 },
      { id: p.responseLink, from: p.target, to: p.source, bytesPerSecond: 1000000000, latencyUs: 1, queueBytes: 100000 });
  }
  const header = { schema: "infraforge-first-stack-schedule/1", unit: "us", durationUs: 5000, origin: "authored-schedule", provenance: "Fixed logical test workload; no physical performance evidence" };
  const rows = Array.from({ length: 24 }, (_, i) => ({ id: `r${String(i).padStart(2, "0")}`, atUs: 5000, operation: "read" }));
  async function* stream() { yield new TextEncoder().encode([header, ...rows].map(x => JSON.stringify(x)).join("\n") + "\n"); }
  const schedule = await resolveWorkload(stream(), { owner: "qualification", sidecar,
    parameters: { schema: "infraforge-first-stack-parameters/1", rows: rows.map(r => ({ id: r.id, plan: options.write ? "write-plan" : "read-plan", keys: options.range ? ["hot", "cold"] : ["hot"] })) } });
  sidecar.workload = { scheduleHash: schedule.scheduleHash, parametersHash: schedule.parametersHash, resolvedIdentity: schedule.identity, executedScheduleHash: schedule.executedScheduleHash };
  const policy = { seed: "first-stack-slice04", horizonUs: 90000, sampleIntervalUs: 1000, maxEvents: 100000, maxSamples: 100, maxRawResults: 24 };
  return { ...fixture, sidecar, schedule, policy, prepare: () => prepareFirstStackExecution("qualification", fixture.layout, sidecar, schedule, policy) };
}
