import { createProductModel2 } from "../../model2/product/run";
import { presentModel2 } from "../../model2/product/presentation";
import { canonical } from "../../model2/product/provenance";
import type { ProductEvidence } from "../../model2/product/presentation";
import type { Estimate, ProviderProduct, Usage } from "./contracts";
import { fraction, fromNumber } from "./exact";
import { estimate, sumEstimates } from "./pricing";
import { timestamp } from "./validity";
import { digest } from "./fingerprint";
import type { ContentHasher } from "./fingerprint";

export function allocationUsage(product: ProviderProduct, e: ProductEvidence) {
  const rows: Usage[] = [], unknown: string[] = [];

  if (e.capture.failure) unknown.push("Runtime capture failed");

  for (const host of product.hosts) {
    const pool = e.product.controllers.find((p) => p.id === host.node);

    if (!pool || pool.omitted) {
      unknown.push(`${host.node}: lifecycle events missing/omitted`);

      continue;
    }

    const starts = new Map<string, typeof pool.events[number]>(), ends = new Map<string, number>(), provisionFailed = new Set<string>();
    for (const event of pool.events) {
      if (event.kind === "artifact-start" && !starts.has(event.id)) starts.set(event.id, event);
      if (event.kind === "terminated") ends.set(event.id, event.at);
      if (event.kind === "provision-failed") provisionFailed.add(event.id);
    }
    for (const replica of pool.replicas) {
      const start = starts.get(replica.id);

      if (!start) {
        if (replica.createdAt !== null && replica.state !== "provisioning" && !provisionFailed.has(replica.id)) unknown.push(`${replica.id}: missing allocation boundary`);

        continue;
      }

      const end = ends.get(replica.id) ?? e.at;

      if (end < start.at || start.at > e.at) {
        unknown.push(`${replica.id}: invalid lifecycle interval`);

        continue;
      }

      rows.push({
        id: `${replica.id}@${start.at}`,

        resource: replica.id,

        meter: "instance-us",

        fromUs: start.at,

        toUs: end,

        quantity: fromNumber(end - start.at),

        scope: host.scope,

        basis: "derived",

        provenance: [
          `product.controllers.${pool.id}.events:artifact-start=${start.at},termination-or-capture=${end}`,

          "provision-complete-to-termination/1: authored mapping to billable allocation; process crash/retry does not stop allocation",

          `${product.facts.version}; ${host.fact.id}`
        ]
      });
    }
  }

  return { rows, unknown };
}
export function providerEvidence(product: ProviderProduct, e: ProductEvidence) {
  const usage = allocationUsage(product, e), estimates: Estimate[] = [];
  // Virtual time is anchored explicitly to the reviewed quote date; no machine clock lookup.

  const from = product.provider.asOf, to = new Date(timestamp(from) + Math.ceil(e.at / 1000)).toISOString();

  for (const host of product.hosts) {
    const rows = usage.rows.filter((r) => host.instances.includes(r.resource));

    const validWindow = timestamp(to) <= timestamp(product.provider.reviewThrough) && host.price && timestamp(from) >= timestamp(host.price.validFrom) && timestamp(to) <= timestamp(host.price.validTo);

    if (host.price && !rows.length && !usage.unknown.length && validWindow) estimates.push({
      kind: "Estimated",

      currency: host.price.currency,

      amount: fraction(0n),

      rule: "known-no-allocated-sessions/1",

      usage: [],

      provenance: [`product.controllers.${host.node}: complete lifecycle coverage with no post-provision allocation`, product.facts.version]
    });
    else estimates.push(host.price && rows.length && !usage.unknown.length && validWindow ? estimate(host.price, rows, { from, to, complete: true }) : {
      kind: "Unknown",

      reason: "Missing price, incomplete lifecycle or outside reviewed estimate window",

      provenance: [host.node, product.facts.version]
    });
  }

  const linkUsage = e.network.links.map((l) => ({
    link: l.id,

    deliveredBytes: l.deliveredBytes,

    provenance: [`network.links.${l.id}.deliveredBytes`],

    scope: "Directed modeled payload bytes, including repeated hops/retries; not provider billable egress"
  }));

  return {
    schema: "infraforge-provider-evidence/1",

    atUs: e.at,

    versions: {
      product: e.product.versions,

      provider: product.provider.version,

      snapshot: product.facts.version,

      meter: "allocation-time/1",

      billing: "exact-graduated/1"
    },

    usage,

    linkUsage,

    estimates,

    selectedComputeSubtotal: sumEstimates(estimates),

    total: {
      kind: "Unknown" as const,

      reason: "Only selected EC2 allocation time estimated; storage, network, managed services, taxes and discounts are unpriced",

      provenance: [product.facts.version]
    },

    placements: product.placements,

    domainEffects: product.domainEffects,

    assumptions: product.provider.hosts.flatMap((h) => h.provenance),

    unknown: product.unknown
  };
}
export function createProviderModel2(compiled: ProviderProduct, hasher: ContentHasher) {
  if (compiled.schema !== "infraforge-provider-compiled/1") throw Error("Unsupported provider compiler version");

  const { fingerprint, ...payload } = compiled;

  if (digest(payload, hasher) !== fingerprint) throw Error("Compiled provider/product content drift; recompile explicitly");

  const product = canonical(compiled), runtime = createProductModel2(product.product);

  return {
    horizon: runtime.horizon,

    advanceTo: runtime.advanceTo,

    evidence() {
      const e = runtime.evidence();

      return { model: e, provider: providerEvidence(product, e) };
    },

    presentation() {
      const e = runtime.evidence(), view = presentModel2(e), provider = providerEvidence(product, e);

      const subtotal = provider.selectedComputeSubtotal;

      const cost = subtotal.kind === "Estimated" ? {
        kind: "Interpreted" as const,

        value: subtotal.amount,

        unit: subtotal.currency,

        atUs: e.at,

        provenance: subtotal.provenance,

        rule: "Conditional exact price × modeled allocation usage; authored state mapping; estimate, not a provider bill"
      } : {
        kind: "Unknown" as const,

        reason: subtotal.reason,

        unit: "USD",

        atUs: e.at,

        provenance: subtotal.provenance
      };

      return {
        ...view,

        schema: "infraforge-provider-presentation/1",

        providerVersions: provider.versions,

        values: {
          ...view.values,

          "cost.total": {
            kind: "Unknown",

            unit: "USD",

            atUs: e.at,

            provenance: provider.total.provenance,

            reason: provider.total.reason
          },

          "cost.selectedCompute": cost
        }
      };
    }
  };
}
