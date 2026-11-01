import type { Resource } from "@infraforge/domain/resource";
import type { Quantity } from "../../reality/quantity";
import { requireKnown } from "../../reality/quantity";
import type { LoadBalancer } from "../network/contracts";
import type { SystemsInput } from "../systems/contracts";

export const LB_HEALTH_PROFILE = "lb-health/1" as const;
export const changedLbHealth = (r: Resource) => r.type === "Load Balancer" && (r.lbHealth?.intervalSeconds !== undefined || r.lbHealth?.timeoutSeconds !== undefined || r.lbHealth?.unhealthyAfter !== undefined || r.lbHealth?.healthyAfter !== undefined);
export const lbHealthChanges = (resources: readonly Resource[]) => resources.some(changedLbHealth);

type QuantityBuilder = <U extends "count" | "us">(id: string, value: number, unit: U, sentence?: string, authored?: boolean) => Quantity<U>;
export function lbHealthPolicy(r: Resource, q: QuantityBuilder): LoadBalancer["health"] {
  const p = r.lbHealth, id = r.id;
  return {
    interval: p?.intervalSeconds !== undefined ? q(`${id}.health.interval`, p.intervalSeconds * 1000000, "us", "Seconds between backend health checks; saved seconds converted to microseconds.", true) : q(`${id}.health.interval`, 5000000, "us"),
    timeout: p?.timeoutSeconds !== undefined ? q(`${id}.health.timeout`, p.timeoutSeconds * 1000000, "us", "Seconds to wait before a health check fails; saved seconds converted to microseconds.", true) : q(`${id}.health.timeout`, 1000000, "us"),
    healthy: p?.healthyAfter !== undefined ? q(`${id}.healthy`, p.healthyAfter, "count", "Consecutive successful checks before routing to a backend again.", true) : q(`${id}.healthy`, 1, "count"),
    unhealthy: p?.unhealthyAfter !== undefined ? q(`${id}.unhealthy`, p.unhealthyAfter, "count", "Consecutive failed checks before removing a backend from routing.", true) : q(`${id}.unhealthy`, 1, "count"),
    operation: "health", initial: "eligible",
  };
}

export function validateLbHealthBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(changedLbHealth)) {
    const lb = input.resources.find(d => d.id === r.id), p = r.lbHealth!;
    if (lb?.kind !== "load-balancer") throw Error("Load balancer health requires its owned load balancer engine");
    if (requireKnown(lb.health.interval, "us") !== (p.intervalSeconds ?? 5) * 1000000 ||
        requireKnown(lb.health.timeout, "us") !== (p.timeoutSeconds ?? 1) * 1000000 ||
        requireKnown(lb.health.unhealthy, "count") !== (p.unhealthyAfter ?? 1) ||
        requireKnown(lb.health.healthy, "count") !== (p.healthyAfter ?? 1) ||
        lb.health.operation !== "health" || lb.health.initial !== "eligible") throw Error("Load balancer health policy must match saved intent");
  }
}
