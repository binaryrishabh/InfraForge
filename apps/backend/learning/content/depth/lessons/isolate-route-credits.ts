import type { LearningLesson } from "@infraforge/contracts/learning";
export const isolateRouteCredits: LearningLesson = {
  id: "isolate-route-credits", contentVersion: 1, trackId: "depth", moduleId: "quota-ownership",
  title: "Isolate route credits", summary: "Explain how a shared quota couples two otherwise separate routes.",
  kind: "executable-lab", level: "intermediate", availability: "available", prerequisites: ["load-balancer-policies", "protect-one-api-route"],
  problem: ["A gateway has spare CPU, yet writes rarely reach their backend. Busy reads share the same small admission bucket."],
  explanation: ["Predict final overall health, run the starter unchanged and keep its report. Record Quota scope, each route's Completed, Admitted and Throttled counts, gateway CPU and rate refusals. Distinguish policy refusals from upstream failures.",
    "Start an improvement from the saved starter with a hypothesis. Select gateway and change only Quota scope from Shared across routes to Separate for each route. Keep both route budgets unchanged. Review exactly one saved change, run with the same workload and seed, then compare both reports and each requirement.",
    "A separate bucket prevents reads from spending write credits. It also increases aggregate possible admission because each route now owns the saved budget. This experiment demonstrates ownership and isolation; it does not hold the gateway-wide total quota constant or prove general fairness.",
    "For a separate near miss, return to the starter and change only writeApp size from small to large. Confirm one change and compare write completions and throttles with the starter. Explain why extra backend CPU leaves the gateway policy budget unchanged. Passing route requirements can still leave many read callers refused and overall health Critical. Missing observations stay Unknown."],
  experiment: {challengeId: "isolate-route-credits", prediction: "Predict overall health when policy throttling causes caller failures despite low gateway CPU.",
    evidenceToInspect: ["Quota scope", "Gateway route: Completed; Gateway route: Admitted; Gateway route: Throttled", "Route throttles (429); Upstream failures (502)", "CPU", "Whole run: Completed; Whole run: Failed"]},
  limitations: ["Results are educational model outputs. They use deterministic InfraForge teaching assumptions, exact routes, an integer refill clock and a fixed traffic pattern; they are not provider quota or throughput benchmarks.",
    "Separate scopes are not the only fix: raising the shared refill to about the call rate would also admit the writes, by admitting almost every read as well; the lab keeps both budgets fixed to isolate ownership. Per-route scope creates a full budget for each route and raises the aggregate admission allowance. No fixed-total fairness, tenant priority, starvation bound or distributed quota coordination is modeled.",
    "Gateway CPU, transport, global in-flight capacity and backends remain shared constraints. Separate credits do not reserve those capacities.",
    "Counters cover the captured six-second window. A terminal health or CPU sample proves neither continuous availability nor recovery time. Historical missing scope remains Unknown."],
  followUp: "Defend the scope choice using write outcomes, refused reads and the larger aggregate quota. Name a shared capacity that could still couple the routes.",
  check: null,
};
