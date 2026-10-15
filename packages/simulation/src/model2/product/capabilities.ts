import { findSku, CATALOG_SNAPSHOT_DATE } from "@infraforge/catalog";
import type { Resource } from "@infraforge/domain/resource";
import type { ProductContract } from "./contracts";
export function capabilityFacts(c: ProductContract, resources: Resource[]) {
  return c.capabilities.map((v) => {
    const resource = resources.find((r) => r.id === v.resource), sku = findSku(v.sku), fact = c.ledger.find((f) => f.id === v.fact);
    const expected = v.field === "vCpu" ? sku?.vCpu : sku?.ramGb, unit = v.field === "vCpu" ? "count" : "GB-label";
    if (!resource || resource.skuId !== v.sku || sku?.category !== resource.type || c.catalogVersion !== CATALOG_SNAPSHOT_DATE || v.catalogVersion !== c.catalogVersion || v.value.kind !== "known" || v.value.unit !== unit || v.value.value !== expected || fact?.classification !== "provider-fact" || !fact.scope.includes(v.sku) || !fact.concept.includes(v.field) || fact.quantity.kind !== "known" || fact.quantity.unit !== unit || fact.quantity.value !== v.value.value || !v.value.provenance.includes(fact.id)) throw Error("Capability requires matching catalog SKU/category/version and exact field-specific external fact; approximate performance/price fields cannot be promoted");
    return { ...v, scope: "Capability descriptor only; never used as effective execution cores, throughput, provision duration, price or available memory" };
  });
}
