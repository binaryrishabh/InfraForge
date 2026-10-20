import type { FirstStackSidecarV3, FirstStackSidecarV2 } from "../../packages/contracts/src/first-stack";
import { firstStackCompileFixture } from "./first-stack-compile";
import { designRevision } from "../../apps/backend/firstStack/canonical";
import { resolveWorkload } from "../../apps/backend/firstStack/workload";
import { prepareFirstStackExecution } from "../../apps/backend/firstStack/execution";

export async function firstStackCacheFixture(options: { apps?: number; coalesce?: boolean; warm?: boolean; ttlUs?: number;
  capacityBytes?: number; eviction?: "lru" | "no-eviction"; policyCpuUs?: number | null; cacheAlive?: boolean; onFailure?: "database" | "fail";
  readBlockingUs?: number; rows?: Array<{ id: string; atUs: number; key: string; operation?: string }> } = {}) {
  const f = await firstStackCompileFixture(options.apps ?? 1), layout = structuredClone(f.layout);
  layout.resources.push({ id: "cache", type: "Cache", x: 30, y: 20 });
  const sidecar: FirstStackSidecarV3 = { ...f.sidecar, schema: "infraforge-first-stack-sidecar/3", compiler: "first-stack-compiler/3", workload: null,
    nodes: [...f.sidecar.nodes, { ...f.sidecar.nodes.find(n => n.id === "db")!, id: "cache", owner: "keyed-cache", host: "host-cache", listenerPort: 6379, alive: options.cacheAlive ?? true }],
    placement: [...f.sidecar.placement, { id: "host-cache", cores: 1, memoryBytes: 1024 }],
    operations: [...f.sidecar.operations.map(o => ({ ...o, ...(o.id === "read" ? { kind: "cache-read" as const } : {}) })),
      { ...f.sidecar.operations[0]!, id: "write", kind: "update", plan: "write-plan" }],
    database: { ...f.sidecar.database, plans: [...f.sidecar.database.plans.map(p => ({ ...p, blockingUs: options.readBlockingUs ?? 0 })), { ...f.sidecar.database.plans[0]!, id: "write-plan", kind: "write", logBytes: 8 }] },
    cache: { node: "cache", semantics: "keyed-cache/1", capacityBytes: options.capacityBytes ?? 1024, entryOverheadBytes: 1,
      ttlUs: options.ttlUs ?? 100000, commandCpuUs: 1, policy: options.eviction ?? "lru",
      initial: options.warm ? [{ key: "hot", version: 1, bytes: 2 }] : [], coalesce: options.coalesce ?? true,
      onFailure: options.onFailure ?? "database", invalidateWrites: true, policyCpuUs: options.policyCpuUs ?? null, roles: [] } };
  const addLinks = (p: FirstStackSidecarV2["paths"][number]) => {
    sidecar.links.push({ id: p.requestLink, from: p.source, to: p.target, bytesPerSecond: 1000000000, latencyUs: 1, queueBytes: 100000 },
      { id: p.responseLink, from: p.target, to: p.source, bytesPerSecond: 1000000000, latencyUs: 1, queueBytes: 100000 });
  };
  for (const app of sidecar.nodes.filter(n => n.owner === "compute")) {
    const edge = { id: `cache-${app.id}`, sourceId: app.id, targetId: "cache", sourceType: "Virtual Machine", targetType: "Cache", port: 6379 };
    layout.connectionLines.push(edge);
    const template = sidecar.paths.find(p => p.source === app.id && p.target === "db")!;
    const make = (id: string, source: string, target: string, port: number) => ({ ...template, pool: { ...template.pool }, id, source, target, port, requestLink: `${id}:req`, responseLink: `${id}:res` });
    const cachePath = make(edge.id, app.id, "cache", 6379); cachePath.pool.connectTimeoutUs = 100; sidecar.paths.push(cachePath); addLinks(cachePath);
    const policy = `${app.id}/cache-policy`, internal = make(`${app.id}:policy`, app.id, policy, 80), database = make(`${app.id}:policy-db`, policy, "db", 5432);
    addLinks(internal); addLinks(database); sidecar.cache.roles.push({ app: app.id, policy, internal, database });
  }
  sidecar.designRevision = designRevision(layout);
  const rows: Array<{ id: string; atUs: number; key: string; operation?: string }> = options.rows ?? [0, 1, 2].map(i => ({ id: `r${i}`, atUs: 5000, key: "hot" }));
  const header = { schema: "infraforge-first-stack-schedule/1", unit: "us", durationUs: Math.max(5000, ...rows.map(r => r.atUs)), origin: "authored-schedule", provenance: "Explicit recorded-key semantic test; no physical timing evidence" };
  async function* stream() { yield new TextEncoder().encode([header, ...rows.map(r => ({ id: r.id, atUs: r.atUs, operation: r.operation ?? "read" }))].map(r => JSON.stringify(r)).join("\n") + "\n"); }
  const schedule = await resolveWorkload(stream(), { owner: "qualification", sidecar,
    parameters: { schema: "infraforge-first-stack-parameters/1", rows: rows.map(r => ({ id: r.id, plan: r.operation === "write" ? "write-plan" : "read-plan", keys: [r.key] })) } });
  sidecar.workload = { scheduleHash: schedule.scheduleHash, parametersHash: schedule.parametersHash, resolvedIdentity: schedule.identity, executedScheduleHash: schedule.executedScheduleHash };
  const policy = { ...f.policy, maxRawResults: rows.length };
  return { layout, sidecar, schedule, policy, prepare: () => prepareFirstStackExecution("qualification", layout, sidecar, schedule, policy) };
}
