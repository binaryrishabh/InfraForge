import { z } from "zod";
import type { FirstStackComputeCost, FirstStackCostComparison } from "@infraforge/contracts/reports";
import { boundedJson, estimate, sameScope, sumEstimates } from "@infraforge/simulation/internal-first-stack";
import type { PriceRule, Usage } from "@infraforge/simulation/internal-first-stack";

const text = z.string().min(1).max(512), id = text.max(160);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const scope = z.object({ provider: id, service: id, product: id, region: id, operatingSystem: id, tenancy: id, purchase: id }).strict();
const tariff = z.object({ id, version: id, source: text, policySources: z.array(text).min(1).max(16), scope,
  meter: z.enum(["instance-us", "byte-us", "operations", "bytes"]), currency: id, validFrom: text, validTo: text,
  aggregation: z.enum(["session", "window"]), per: id, increment: id, minimum: id,
  tiers: z.array(z.object({ from: id, to: id.nullable(), price: id }).strict()).min(1).max(64),
  provenance: z.enum(["provider-fact", "authored"]), exclusions: z.array(text).min(1).max(32) }).strict();
export const computeTariffSelectionSchema = z.object({ schema: z.literal("first-stack-compute-tariffs/1"),
  window: z.object({ from: text, to: text, complete: z.boolean() }).strict(),
  allocations: z.array(z.object({ id, host: id, scope, tariff: tariff.nullable(), provenance: z.array(text).min(1).max(16) }).strict()).min(1).max(32),
}).strict();
export type ComputeTariffSelection = z.infer<typeof computeTariffSelectionSchema>;
const allocationUsageSchema = z.object({ schema: z.literal("first-stack-allocation-usage/1"), basis: z.literal("modeled-fixed-host-window/1"),
  fromUs: z.literal(0), throughUs: count.positive(), timestampComplete: z.boolean(),
  allocations: z.array(z.object({ id, host: id, fromUs: count, toUs: count, instanceUs: count }).strict()).min(1).max(32) }).strict();
const topologySchema = z.object({ nodes: z.array(z.object({ id, host: id, owner: id })).max(32), placement: z.array(z.object({ id })).max(32) });
const exclusions = ["Unselected compute allocations", "Load balancer", "Relational database (no RDS inference)", "Cache",
  "Storage", "Backups", "Addresses", "Transfer", "Account-pool reconciliation, taxes and discounts"];

export function unknownComputeCost(reason: string): FirstStackComputeCost {
  return { label: "supported compute subtotal", support: "supported-logical",
    conditional: "Frozen tariff × explicitly selected modeled allocation time; not a provider bill",
    subtotal: { kind: "Unknown", reason, provenance: [] }, window: null, covered: [], exclusions: [...exclusions],
    fullCost: { kind: "Unknown", reason: "Missing LB/DB/cache/storage/backups/address/transfer/account-pool reconciliation; excluded components have no zero default" } };
}

// SERVER projection: tariffs are supplied separately from verified simulated
// usage. No clock/catalog lookup, monthly extrapolation or cloud-state inference.
export function firstStackComputeCost(value: unknown, usage: unknown, topology: unknown, throughUs: number, timestampComplete: boolean): FirstStackComputeCost {
  const result = unknownComputeCost("No eligible frozen tariff and complete selected allocation usage were recorded");
  if (value === undefined) return result;
  try {
    boundedJson(value, 64 * 1024);
    boundedJson(usage, 16 * 1024);
    const evidence = computeTariffSelectionSchema.parse(value), observed = allocationUsageSchema.parse(usage), graph = topologySchema.parse(topology);
    result.window = evidence.window;
    const fail = (reason: string): never => { throw Error(reason); };
    if (!timestampComplete || !observed.timestampComplete || !evidence.window.complete || observed.throughUs !== throughUs) fail("Allocation aggregation window is incomplete or mismatched");
    if (Date.parse(evidence.window.to) - Date.parse(evidence.window.from) !== Math.ceil(throughUs / 1000)) fail("Frozen tariff window does not match the verified usage interval");
    if (new Set(graph.nodes.map(n => n.id)).size !== graph.nodes.length || new Set(graph.placement.map(h => h.id)).size !== graph.placement.length) fail("Duplicate topology identity");
    const allocations = new Set(evidence.allocations.map(a => a.id));
    if (allocations.size !== evidence.allocations.length || new Set(observed.allocations.map(a => a.id)).size !== observed.allocations.length ||
      new Set(observed.allocations.map(a => a.host)).size !== observed.allocations.length) fail("Duplicate allocation or host usage identity");
    if (observed.allocations.some(a => a.fromUs !== 0 || a.toUs !== throughUs || a.instanceUs !== throughUs || !graph.placement.some(h => h.id === a.host))) fail("Fixed-host instance-time does not conserve the verified interval");
    const rows: Usage[] = [], prices: PriceRule[] = [];
    for (const a of evidence.allocations) {
      const roles = graph.nodes.filter(n => n.host === a.host);
      if (!graph.placement.some(h => h.id === a.host) || !roles.some(n => n.owner === "compute")) fail("Select an explicit compute host; relational/cache/LB icons and generic cores are not EC2 bindings");
      const allocation = observed.allocations.find(u => u.id === a.id && u.host === a.host);
      if (!allocation) throw Error("Selected allocation has no matching verified host usage");
      const { fromUs, toUs } = allocation;
      if (!a.tariff || a.tariff.provenance !== "provider-fact" || !sameScope(a.scope, a.tariff.scope)) throw Error("Missing or unsupported exact provider/product/location/OS/tenancy/purchase tariff");
      const usage: Usage = { id: `${a.id}@${fromUs}`, resource: a.host, meter: "instance-us", fromUs, toUs,
        quantity: { numerator: String(toUs - fromUs), denominator: "1" }, scope: a.scope, basis: "derived",
        provenance: [...a.provenance, `${observed.basis}:${a.id}@${fromUs}..${toUs}`, "Verified fixed-host occupancy window; process crash/retry does not terminate allocation; horizon is not termination"] };
      // Validate every quote and row before exposing any covered charge.
      const priced = estimate(a.tariff, [usage], evidence.window);
      if (priced.kind === "Unknown") fail(priced.reason);
      rows.push(usage); prices.push(a.tariff);
    }
    // The same modeled host cannot be charged twice through shared roles or
    // overlapping allocation IDs, even if the selected tariff IDs differ.
    for (let i = 0; i < rows.length; i++) for (let j = 0; j < i; j++) {
      const a = rows[i]!, b = rows[j]!;
      if (a.resource === b.resource && (a.fromUs === b.fromUs || (a.fromUs < b.toUs && b.fromUs < a.toUs))) fail("Duplicate/overlapping host allocation usage");
    }
    const subtotal = sumEstimates(rows.map((r, i) => estimate(prices[i]!, [r], evidence.window)));
    if (subtotal.kind === "Unknown") fail(subtotal.reason);
    result.subtotal = subtotal;
    result.covered = rows.map((r, i) => { const p = prices[i]!; return {
      allocation: evidence.allocations[i]!.id, host: r.resource, roles: graph.nodes.filter(n => n.host === r.resource).map(n => n.id),
      meter: "instance-us", usage: r.id, fromUs: r.fromUs, toUs: r.toUs, quantity: r.quantity, scope: r.scope,
      tariff: { id: p.id, version: p.version, source: p.source, policySources: p.policySources, currency: p.currency, validFrom: p.validFrom, validTo: p.validTo,
        per: p.per, increment: p.increment, minimum: p.minimum, aggregation: p.aggregation, tiers: p.tiers } }; });
    result.exclusions.push(...prices.flatMap(p => p.exclusions));
  } catch (error) {
    result.subtotal = { kind: "Unknown", reason: error instanceof Error ? error.message : "Invalid frozen compute cost evidence", provenance: [] };
    result.covered = [];
  }
  return result;
}

export function compareFirstStackCosts(left: FirstStackComputeCost, right: FirstStackComputeCost): FirstStackCostComparison {
  return { label: "supported compute subtotal", interpretation: "Conditional selected allocation scenarios; full costs remain Unknown", left, right };
}
