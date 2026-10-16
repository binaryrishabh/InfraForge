import type { Quantity } from "../quantity";
import type { CompiledProduct, ProductContract, SavedProductDesign } from "../../model2/product/contracts";

export interface Source {
  id: string;

  url: string;

  publicationDate: string | null;

  retrievedAt: string;

  validFrom: string;

  reviewThrough: string;

  uncertainty: string[];

  contentSha256?: string;
}
export interface Location {
  id: string;

  provider: string;

  partition: string;

  kind: "region" | "zone";

  parent?: string;

  source: string;
}
export interface InstanceFact {
  id: string;

  provider: string;

  service: "AmazonEC2";

  sku: string;

  region: string;

  vCpu: number;

  memoryBytes: string;

  source: string;

  availability: "regional-price-listed";
}
export type Meter = "instance-us" | "byte-us" | "operations" | "bytes";
export interface Scope {
  provider: string;

  service: string;

  product: string;

  region: string;

  operatingSystem: string;

  tenancy: string;

  purchase: string;
}
export interface Tier {
  from: string;

  to: string | null;

  price: string
}
export interface PriceRule {
  id: string;

  version: string;

  source: string;
  policySources: string[];

  scope: Scope;

  meter: Meter;

  currency: string;

  validFrom: string;

  validTo: string;

  aggregation: "session" | "window";
  // All quantities use the raw meter unit. Tiers are graduated, not volume pricing.

  per: string;

  increment: string;

  minimum: string;

  tiers: Tier[];

  provenance: "provider-fact" | "authored";

  exclusions: string[];
}
export interface ProviderSnapshot {
  schema: "infraforge-provider-facts/1";

  version: string;

  sources: Source[];

  locations: Location[];

  instances: InstanceFact[];

  prices: PriceRule[];
}
export interface Placement {
  instance: string;

  location: string
}
export interface HostBinding {
  node: string;
  scope: Scope;

  fact: string;

  price: string | null;

  roles: Array<{
    role: string;

    memory: Quantity<"bytes">;

    mode: "compute-admission" | "reservation"
  }>;

  placements: Placement[];
  // This is a reviewed modeled allocation assumption, not an observed EC2 state.

  lifecycle: "provision-complete-to-termination/1";

  provenance: string[];
}
export interface DomainFault {
  id: string;

  profile: "selected-process-loss/1";

  domain: string;

  nodes: string[];

  at: Quantity<"us">;

  duration: Quantity<"us">;

  restart: Quantity<"us">;

  provenance: string[];
}
export interface ProviderContract {
  schema: "infraforge-provider-product/1";

  version: string;

  snapshot: string;

  fingerprint: string;

  asOf: string;

  reviewThrough: string;

  hosts: HostBinding[];

  relationships: Array<{
    left: string;

    right: string;

    rule: "same-zone" | "different-zone"
  }>;

  faults: DomainFault[];
}
export interface ProviderProduct {
  schema: "infraforge-provider-compiled/1";

  fingerprint: string;

  product: CompiledProduct;

  facts: ProviderSnapshot;

  provider: ProviderContract;

  placements: Placement[];

  hosts: Array<{
    node: string;
    scope: Scope;

    instances: string[];

    fact: InstanceFact;

    price: PriceRule | null
  }>;

  domainEffects: Array<{
    fault: string;

    domain: string;

    targets: string[]
  }>;

  unknown: string[];
}
export interface Rational {
  numerator: string;

  denominator: string
}
export interface Usage {
  id: string;

  resource: string;

  meter: Meter;

  quantity: Rational;

  fromUs: number;

  toUs: number;

  scope: Scope;

  provenance: string[];

  basis: "observed-model" | "authored" | "derived";
}
export type Estimate = {
  kind: "Estimated";

  currency: string;

  amount: Rational;

  rule: string;

  usage: string[];

  provenance: string[]
}
  | {
    kind: "Unknown";

    reason: string;

    provenance: string[]
  };
export type ProductInputs = {
  design: SavedProductDesign;

  contract: ProductContract
};
