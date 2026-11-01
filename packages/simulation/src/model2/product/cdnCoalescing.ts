import type { Resource } from "@infraforge/domain/resource";
import { requireKnown, type Quantity } from "../../reality/quantity";
import type { ProductContract } from "./contracts";
import type { SystemsInput } from "../systems/contracts";

export const CDN_COALESCING_PROFILE = "cdn-coalescing/1" as const;
export const changedCdnCoalescing = (r: Resource) => r.cdnCachePolicy?.version === 2;
export const cdnCoalescingChanges = (resources: readonly Resource[]) => resources.some(changedCdnCoalescing);
export function cdnCoalescing(r: Resource, q: (id: string, value: number, unit: "count", sentence?: string, authored?: boolean) => Quantity<"count">) {
  const p = r.cdnCachePolicy;
  return { coalesce: p?.version === 2 ? p.coalesce : true, maxWaiters: p?.version === 2 && p.maxWaiters !== undefined
    ? q(`${r.id}.waiters`, p.maxWaiters, "count", "Saved maximum requests sharing one in-progress same-key origin fetch, including its first request.", true)
    : q(`${r.id}.waiters`, 256, "count") };
}
export function validateCdnCoalescingProfile(resources: readonly Resource[], contract: ProductContract) {
  const count = (version: string) => version.split(`/${CDN_COALESCING_PROFILE}`).length - 1;
  if (count(contract.version) !== Number(cdnCoalescingChanges(resources))) throw Error("CDN coalescing requires its explicit cdn-coalescing/1 contract version and matching saved intent");
  for (const r of resources) if (count(contract.nodes[r.id]?.profileVersion ?? "") !== Number(changedCdnCoalescing(r))) throw Error("CDN coalescing requires its owned profile and matching saved intent");
}
export function validateCdnCoalescingBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(changedCdnCoalescing)) {
    const p = r.cdnCachePolicy, cdn = input.resources.find(c => c.id === r.id);
    if (p?.version !== 2 || r.type !== "CDN" || cdn?.kind !== "cdn") throw Error("Coalescing requires its owned CDN engine");
    if (cdn.coalesce !== p.coalesce || requireKnown(cdn.maxWaiters, "count") !== (p.maxWaiters ?? 256) || requireKnown(cdn.ttl, "us") !== (p.ttlSeconds ?? 60) * 1000000) throw Error("CDN coalescing, waiter limit and TTL must match saved intent");
  }
}
