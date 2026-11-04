import { serverlessError, resolveServerless, type Resource, type ConnectionLine } from "@infraforge/domain/resource";
import { requireKnown, type Quantity, type Unit } from "../../reality/quantity";
import type { ComputeResource } from "../compute/contracts";
import type { SystemsInput } from "../systems/contracts";
import type { ServerlessConfig } from "./contracts";
export const SERVERLESS_PROFILE = "serverless/1" as const;
export const serverlessIntent = (resources: readonly Resource[]) => resources.some(r => r.type === "Serverless Function" || r.serverless !== undefined);
type Q = <U extends Unit>(id: string, value: number, unit: U, sentence?: string, authored?: boolean) => Quantity<U>;
const quantities = { concurrency: ["concurrency", "count", 1], initializationMs: ["initialization", "us", 1000], durationMs: ["duration", "us", 1000], timeoutMs: ["timeout", "us", 1000], idleExpiryMs: ["idleExpiry", "us", 1000], failurePercent: ["failurePercent", "percent", 1] } as const;
function database(r: Resource, resources: readonly Resource[], connections: readonly ConnectionLine[]) {
  const outputs = connections.filter(e => e.sourceId === r.id), target = resources.find(t => t.id === outputs[0]?.targetId);
  if (outputs.length > 1 || (outputs.length && target?.type !== "Database")) throw Error("Serverless Function supports one optional attached Database");
  return target;
}
export function serverlessTemplate(r: Resource, resources: readonly Resource[], connections: readonly ConnectionLine[], execution: ComputeResource, q: Q): Omit<ServerlessConfig, "id"> {
  const s = resolveServerless(r.serverless), db = database(r, resources, connections);
  const values = Object.fromEntries(Object.entries(quantities).map(([key, [field, unit, scale]]) => [field, q(`${r.id}.serverless.${key}`, s[key as keyof typeof quantities] * scale, unit, "Educational per-invocation lifecycle assumption; elapsed durations do not claim CPU, provider timing, capacity or price.", r.serverless?.[key as keyof typeof quantities] !== undefined)]));
  return { ...values, kind: "serverless", profile: "invocation-warm-reuse/1", execution, ...(db ? { database: `$${db.id}` } : {}) } as Omit<ServerlessConfig, "id">;
}
export function validateServerlessBindings(resources: readonly Resource[], connections: readonly ConnectionLine[], input: SystemsInput) {
  for (const r of resources) {
    const error = serverlessError(r.type, r.serverless); if (error) throw Error(error);
    if (r.type !== "Serverless Function") continue;
    const actual = input.resources.find(s => s.id === r.id), s = resolveServerless(r.serverless), db = database(r, resources, connections);
    if (actual?.kind !== "serverless" || actual.database !== db?.id) throw Error("Function must match its saved database binding");
    for (const [key, [field, unit, scale]] of Object.entries(quantities)) if (requireKnown(actual[field], unit) !== s[key as keyof typeof quantities] * scale) throw Error("Function quantities must match saved intent");
    if (db) {
      const path = input.paths.find(p => p.source === r.id && p.target === db.id);
      if (!path || path.pool.mode !== "serial" || !path.pool.reuse) throw Error("Functions require their captured shared serial database pool");
    }
  }
}
