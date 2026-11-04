import type { ServerlessConfig } from "../src/model2/serverless/contracts";
import { prepare, design } from "./asyncCanvas.fixture";
export function functionConfig(patch: Partial<ServerlessConfig> = {}): ServerlessConfig {
  const execution = prepare(design(false)).compiled.input.resources.find(r => r.kind === "compute")!;
  if (execution.kind !== "compute") throw Error("execution");
  return { id: "fn", kind: "serverless", profile: "invocation-warm-reuse/1", execution, concurrency: count(2), initialization: us(10000), duration: us(10000), timeout: us(100000), idleExpiry: us(50000), failurePercent: { kind: "known", unit: "percent", value: 0, provenance: ["test"] }, ...patch };
}
export const us = (value: number) => ({ kind: "known" as const, unit: "us" as const, value, provenance: ["test"] });
export const count = (value: number) => ({ kind: "known" as const, unit: "count" as const, value, provenance: ["test"] });
