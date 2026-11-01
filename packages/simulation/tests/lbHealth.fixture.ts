import type { LbHealth } from "@infraforge/domain/resource";
import { lbDesign } from "./lbAdmission.fixture";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { withTimeline } from "../src/model2/product/timeline";
import { createLiveModel2 } from "../src/model2/product/live";

export const healthPolicy: LbHealth = { version: 1, intervalSeconds: 1, timeoutSeconds: 1, unhealthyAfter: 1, healthyAfter: 1 };
export function healthScenario(policy = healthPolicy, options: { rps?: number; readWriteRatio?: number; fault?: "crash" | "delay" | "none"; resilience?: "retry" | "breaker" } = {}) {
  const design = lbDesign(), lb = design.resources[0]!;
  lb.lbHealth = policy;
  design.resources[1]!.size = "small";
  design.resources.push({ id: "survivor", type: "Virtual Machine", x: 2, y: 0, size: "small" });
  design.connections.push({ ...design.connections[0]!, id: "remaining", targetId: "survivor" });
  design.workload.targetThroughput = (options.rps ?? 40) * 60;
  design.workload.readWriteRatio = options.readWriteRatio ?? 1;
  if (options.resilience) lb.retry = { enabled: true, maxAttempts: 2, backoffMs: 10, jitterRatio: 0, maxConcurrentRetries: 4, retryOn: ["backendFailure", "timeout"] };
  if (options.resilience === "breaker") lb.circuitBreaker = { enabled: true, failureThreshold: 1, cooldownMs: 100 };
  const built = contractFromDesign(design);
  if ("refused" in built) throw Error(JSON.stringify(built.refused));
  built.contract.seed = "lb-health-proof";
  // Retain complete request and network rows for these bounded comparison windows.
  built.contract.limits.maxRawResults = 100000;
  const initial = compileProduct(design, built.contract);
  if (!initial.ok) throw Error(JSON.stringify(initial.diagnostics));
  const fault = options.fault ?? "crash";
  const contract = withTimeline(built.contract, fault === "none" ? [] : fault === "crash"
    ? [{ id: "outage", kind: "crash", node: "app", atUs: 1500000, durationUs: 6000000, restartUs: 500000 }]
    : [{ id: "slow-check", kind: "network-delay", links: initial.value.input.paths.find(p => p.source === "lb" && p.target === "app")!.request, atUs: 0, durationUs: 7000000, delayUs: 1500000 }]);
  const result = compileProduct(design, contract);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return { design, contract, compiled: result.value, live: createLiveModel2(result.value, design.resources.map(r => r.id)) };
}

export function observeHealth(f: ReturnType<typeof healthScenario>, seconds = 16) {
  const views = Array.from({ length: seconds }, () => { f.live.advanceSecond(); return f.live.project(); });
  const evidence = f.live.evidence(), trace = evidence.network.trace.events;
  if (evidence.network.trace.omitted || evidence.resultRetention.omitted) throw Error("Health comparison needs complete retained evidence");
  const checks = trace.filter(r => r.kind === "health-observation" && JSON.parse(r.id)[2] === "app");
  const removed = checks.find(r => r.detail.endsWith("eligible=false"))?.at;
  const returned = removed === undefined ? undefined : checks.find(r => r.at > removed && r.detail.endsWith("eligible=true"))?.at;
  const selected = trace.filter(r => r.kind === "lb-selected");
  return { views, evidence, checks, selected, removed, returned };
}
