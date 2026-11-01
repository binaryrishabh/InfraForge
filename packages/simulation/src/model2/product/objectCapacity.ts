import type { Resource } from "@infraforge/domain/resource";
import { requireKnown, type Quantity } from "../../reality/quantity";
import type { ProductContract } from "./contracts";
import type { SystemsInput } from "../systems/contracts";

export const OBJECT_CAPACITY_PROFILE = "object-capacity/1" as const;
export const changedObjectCapacity = (r: Resource) => r.objectStoragePolicy !== undefined;
export const objectCapacityChanges = (resources: readonly Resource[]) => resources.some(changedObjectCapacity);
export function objectCapacity(r: Resource, role: string, memoryGb: number, q: (id: string, value: number, unit: "bytes", sentence?: string, authored?: boolean) => Quantity<"bytes">, ledger: ProductContract["ledger"]) {
  const p = r.objectStoragePolicy;
  if (p === undefined) return q(`${r.id}.${role}.capacity`, memoryGb * 1073741824, "bytes");
  const sentence = "Saved educational modeled byte ownership limit in whole MiB converted exactly to bytes; no provider storage capacity claim.";
  const capacity = q(`${r.id}.${role}.capacity`, p.capacityMiB * 1048576, "bytes", sentence, true);
  Object.assign(ledger.at(-1)!, { classification: "derived", formula: `${p.capacityMiB} * 1048576`, provenance: [{ source: `saved-design:${r.id}.objectStoragePolicy.capacityMiB`, supports: "implementation", detail: sentence }] });
  return capacity;
}
export function validateObjectCapacityProfile(resources: readonly Resource[], contract: ProductContract) {
  const count = (version: string) => {
    const profiles = version.match(/\/object-capacity\/[^/]+/g) ?? [];
    if (profiles.some(p => p !== `/${OBJECT_CAPACITY_PROFILE}`)) throw Error("Unsupported object capacity profile");
    return profiles.length;
  };
  if (count(contract.version) !== Number(objectCapacityChanges(resources))) throw Error("Object capacity requires its explicit object-capacity/1 contract version and matching saved intent");
  for (const r of resources) if (count(contract.nodes[r.id]?.profileVersion ?? "") !== Number(changedObjectCapacity(r))) throw Error("Object capacity requires its owned profile and matching saved intent");
}
export function validateObjectCapacityBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(changedObjectCapacity)) {
    const p = r.objectStoragePolicy, store = input.resources.find(c => c.id === r.id);
    if (!p || r.type !== "Object Storage" || store?.kind !== "object-store" || !store.capacity || requireKnown(store.capacity, "bytes") !== p.capacityMiB * 1048576) throw Error("Object capacity must match saved intent on its owned Object Storage engine");
  }
}
