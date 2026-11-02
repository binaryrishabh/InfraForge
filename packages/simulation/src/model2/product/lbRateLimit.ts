import { lbRateLimitError, type Resource } from "@infraforge/domain/resource";
import { requireKnown, type Quantity } from "../../reality/quantity";
import type { LoadBalancer } from "../network/contracts";
import type { SystemsInput } from "../systems/contracts";

export const LB_RATE_LIMIT_PROFILE = "lb-rate-limit/1" as const;
export const lbRateLimitChanges = (resources: readonly Resource[]) => resources.some(r => r.lbRateLimit !== undefined);
type QuantityBuilder = <U extends "count" | "us">(id: string, value: number, unit: U, sentence?: string, authored?: boolean) => Quantity<U>;
export const lbRefillUs = (rate: number) => Math.round(1000000 / rate);
export function lbRateLimit(r: Resource, q: QuantityBuilder): { rateLimit?: LoadBalancer["rateLimit"] } {
  const p = r.lbRateLimit; if (!p) return {};
  const error = lbRateLimitError(r.type, p); if (error) throw Error(error);
  return { rateLimit: { profile: LB_RATE_LIMIT_PROFILE, burst: q(`${r.id}.rateLimit.burst`, p.burstRequests, "count", "Saved maximum burst of admitted requests; bucket starts full.", true),
    refillEvery: q(`${r.id}.rateLimit.refill`, lbRefillUs(p.sustainedRequestsPerSecond), "us", "Saved sustained requests per second converted to nearest whole-microsecond period; one request token per period; spent on admission and never refunded.", true) } };
}

export function validateLbRateLimitBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources) {
    const lb = input.resources.find(d => d.id === r.id), p = r.lbRateLimit;
    if (lb?.kind !== "load-balancer") { if (p) throw Error("Rate limit requires its owned load balancer engine"); continue; }
    if (p ? !lb.rateLimit || lb.rateLimit.profile !== LB_RATE_LIMIT_PROFILE || requireKnown(lb.rateLimit.burst, "count") !== p.burstRequests || requireKnown(lb.rateLimit.refillEvery, "us") !== lbRefillUs(p.sustainedRequestsPerSecond) : lb.rateLimit !== undefined) throw Error("Load balancer rate limit must match saved intent");
  }
}
