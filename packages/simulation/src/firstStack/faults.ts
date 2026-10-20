import type { FirstStackSidecarV2 } from "@infraforge/contracts/first-stack";
import type { DataInput } from "../model2/data/contracts";
import type { StackComposition } from "../model2/composition/run";
import type { Quantity, Unit } from "../reality/quantity";
import { requireKnown } from "../reality/quantity";
import { refuse } from "./bounds";

// Finite recorded scenarios only. Cache roles, DB crashes and CPU competitors
// require their own ownership policy and are deliberately absent from this schema.
export function compileScenario(sidecar: FirstStackSidecarV2, input: DataInput, composition: StackComposition,
  q: <U extends Unit>(path: string, value: number | null, unit: U) => Quantity<U>) {
  const horizon = requireKnown(input.horizon, "us"), seen = new Set<string>();
  const intervals = new Map<string, number>();
  if (sidecar.faults.length > 64) refuse("faults", "At most 64 finite fault commands are supported.");
  for (const f of [...sidecar.faults].sort((a, b) => a.atUs - b.atUs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (seen.has(f.id)) refuse("faults", "Duplicate fault command ID."); seen.add(f.id);
    const end = f.atUs + (f.kind === "app-process-crash" ? f.downtimeUs + f.recoveryUs : f.durationUs);
    const owner = `${f.kind === "app-process-crash" ? "process" : "link"}:${f.target}`;
    if (!Number.isSafeInteger(f.atUs) || !Number.isSafeInteger(end) || f.atUs < 0 || end > horizon || end <= f.atUs || (intervals.get(owner) ?? -1) >= f.atUs) refuse(`faults.${f.id}`, "Require finite non-overlapping owner intervals within the horizon (including process recovery).");
    intervals.set(owner, end);
    if (f.schema !== "first-stack-fault/1") refuse(`faults.${f.id}`, "Unsupported fault schema.");
    if (f.kind === "app-process-crash") {
      const n = sidecar.nodes.find(n => n.id === f.target);
      if (n?.owner !== "compute" || !n.alive || !n.ready || f.downtimeUs <= 0 || f.recoveryUs <= 0) refuse(`faults.${f.id}`, "Crash needs an initially ready compute process and positive explicit downtime and recovery delay.");
      (composition.processFaults ??= []).push({ id: f.id, target: f.target, atUs: f.atUs, readyAtUs: end });
    } else if (f.kind === "directed-delay" || f.kind === "directed-partition") {
      if (!sidecar.links.some(l => l.id === f.target) || f.durationUs <= 0) refuse(`faults.${f.id}`, "Name one explicit directed link with a positive duration.");
      const base = { id: f.id, target: f.target, at: q(`faults.${f.id}.at`, f.atUs, "us"), duration: q(`faults.${f.id}.duration`, f.durationUs, "us") };
      input.networkInterventions.push(f.kind === "directed-delay" ? { ...base, kind: "delay", delay: q(`faults.${f.id}.delay`, f.delayUs, "us") } : { ...base, kind: "partition" });
    } else refuse("faults", "Unsupported fault; CPU competitors and cache lifecycle are unavailable.");
  }
  const retry = sidecar.retry;
  if (retry) {
    if (!Number.isSafeInteger(retry.backoffUs) || retry.backoffUs <= 0 || !Number.isSafeInteger(retry.maxConcurrentRetries) || retry.maxConcurrentRetries < 1 || retry.maxConcurrentRetries > 10000 || retry.schema !== "first-stack-read-retry/1" || retry.owner !== "load-balancer" || retry.maxAttempts !== 2 || !retry.operations.length || new Set(retry.operations).size !== retry.operations.length) refuse("retry", "Require one LB retry owner, at most two attempts and unique read operations.");
    for (const id of retry.operations) {
      const op = sidecar.operations.find(o => o.id === id), plan = sidecar.database.plans.find(p => p.id === op?.plan);
      if (!op || !["point-read", "range-read"].includes(op.kind) || plan?.kind !== "read") refuse("retry.operations", "Only explicit idempotent foreground reads can retry; writes and health cannot auto-retry.");
    }
    const lb = input.resources.find(r => r.kind === "load-balancer");
    if (lb?.kind !== "load-balancer") throw Error("Missing retry owner");
    lb.retry = { operations: [...retry.operations].sort(), maxAttempts: q("retry.attempts", 2, "count"), backoff: q("retry.backoff", retry.backoffUs, "us"),
      jitter: q("retry.jitter", 0, "ratio"), maxConcurrentRetries: q("retry.concurrent", retry.maxConcurrentRetries, "count"),
      retryOn: ["acquire-timeout", "connect-timeout", "response-timeout", "reset", "pool-overflow", "link-overflow", "backend-rejected"], allowAmbiguousNonIdempotent: false };
  }
}
