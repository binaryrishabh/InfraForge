import type { Resource } from "@infraforge/domain/resource";
import type { Quantity } from "../../reality/quantity";
import { requireKnown } from "../../reality/quantity";
import type { LoadBalancer } from "../network/contracts";
import type { SystemsInput } from "../systems/contracts";

export const LB_ADMISSION_PROFILE = "lb-admission/1" as const;
export const changedLbAdmission = (r: Resource) => r.type === "Load Balancer" && (r.lbAdmission?.maxActive !== undefined || r.lbAdmission?.maxQueued !== undefined || r.lbAdmission?.queueWaitMs !== undefined);
export const lbAdmissionChanges = (resources: readonly Resource[]) => resources.some(changedLbAdmission);

type Gates = Pick<LoadBalancer, "maxOutstanding" | "maxPending" | "pendingTimeout">;
type QuantityBuilder = <U extends "count" | "us">(id: string, value: number, unit: U, sentence?: string, authored?: boolean) => Quantity<U>;
export function lbAdmissionGates(r: Resource, cores: number, q: QuantityBuilder): Gates {
  const p = r.lbAdmission, id = r.id;
  return {
    maxOutstanding: p?.maxActive !== undefined ? q(`${id}.outstanding`, p.maxActive, "count", "Active requests: how many requests the balancer forwards at once.", true) : q(`${id}.outstanding`, 1024 * cores, "count"),
    maxPending: p?.maxQueued !== undefined ? q(`${id}.pending`, p.maxQueued, "count", "Queued requests: how many more may wait for a free slot.", true) : q(`${id}.pending`, 256, "count"),
    pendingTimeout: p?.queueWaitMs !== undefined ? q(`${id}.timeout`, p.queueWaitMs * 1000, "us", "Queue wait: how long a request may wait before it is refused; saved milliseconds converted to microseconds.", true) : q(`${id}.timeout`, 1000000, "us"),
  };
}

export function validateLbAdmissionBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(changedLbAdmission)) {
    const lb = input.resources.find(d => d.id === r.id), p = r.lbAdmission!;
    if (lb?.kind !== "load-balancer") throw Error("Load balancer admission requires its owned load balancer engine");
    if ((p.maxActive !== undefined && requireKnown(lb.maxOutstanding, "count") !== p.maxActive) ||
        (p.maxQueued !== undefined && requireKnown(lb.maxPending, "count") !== p.maxQueued) ||
        (p.queueWaitMs !== undefined && requireKnown(lb.pendingTimeout, "us") !== p.queueWaitMs * 1000)) throw Error("Load balancer admission gates must match saved intent");
  }
}
