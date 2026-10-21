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
export const computeCostEvidenceSchema = z.object({ schema: z.literal("first-stack-compute-cost/1"),
  window: z.object({ from: text, to: text, complete: z.boolean() }).strict(),
  allocations: z.array(z.object({ id, host: id, scope, tariff: tariff.nullable(), provenance: z.array(text).min(1).max(16) }).strict()).min(1).max(32),
  events: z.array(z.object({ id, allocation: id, kind: z.enum(["allocated", "terminated"]), atUs: count }).strict()).max(64),
}).strict();
export type ComputeCostEvidence = z.infer<typeof computeCostEvidenceSchema>;
const topologySchema = z.object({ nodes: z.array(z.object({ id, host: id, owner: id })).max(32), placement: z.array(z.object({ id })).max(32) });
const exclusions = ["Unselected compute allocations", "Load balancer", "Relational database (no RDS inference)", "Cache",
  "Storage", "Backups", "Addresses", "Transfer", "Account-pool reconciliation, taxes and discounts"];

export function unknownComputeCost(reason: string): FirstStackComputeCost {
  return { label: "supported compute subtotal", support: "supported-logical",
    conditional: "Frozen tariff × explicitly selected modeled allocation time; not a provider bill",
    subtotal: { kind: "Unknown", reason, provenance: [] }, window: null, covered: [], exclusions: [...exclusions],
    fullCost: { kind: "Unknown", reason: "Missing LB/DB/cache/storage/backups/address/transfer/account-pool reconciliation; excluded components have no zero default" } };
}

// Read only frozen capture bytes. No clock, catalogue lookup, icon/SKU inference,
// monthly extrapolation, or reinterpretation of process faults as allocation loss.
export function firstStackComputeCost(value: unknown, topology: unknown, throughUs: number, timestampComplete: boolean): FirstStackComputeCost {
  const result = unknownComputeCost("No eligible frozen tariff and complete selected allocation usage were recorded");
  if (value === undefined) return result;
  try {
    boundedJson(value, 64 * 1024);
    const evidence = computeCostEvidenceSchema.parse(value), graph = topologySchema.parse(topology);
    result.window = evidence.window;
    const fail = (reason: string): never => { throw Error(reason); };
    if (!timestampComplete || !evidence.window.complete) fail("Allocation aggregation window is incomplete");
    if (new Set(graph.nodes.map(n => n.id)).size !== graph.nodes.length || new Set(graph.placement.map(h => h.id)).size !== graph.placement.length) fail("Duplicate topology identity");
    const allocations = new Set(evidence.allocations.map(a => a.id));
    if (allocations.size !== evidence.allocations.length || new Set(evidence.events.map(e => e.id)).size !== evidence.events.length) fail("Duplicate allocation or usage event identity");
    if (evidence.events.some(e => !allocations.has(e.allocation) || e.atUs > throughUs)) fail("Usage event outside selected allocations or retained interval");
    const rows: Usage[] = [], prices: PriceRule[] = [];
    for (const a of evidence.allocations) {
      const roles = graph.nodes.filter(n => n.host === a.host);
      if (!graph.placement.some(h => h.id === a.host) || !roles.some(n => n.owner === "compute")) fail("Select an explicit compute host; relational/cache/LB icons and generic cores are not EC2 bindings");
      const events = evidence.events.filter(e => e.allocation === a.id), starts = events.filter(e => e.kind === "allocated"), stops = events.filter(e => e.kind === "terminated");
      if (starts.length !== 1 || stops.length !== 1 || events.length !== 2) fail("Missing or duplicate allocation start/termination usage; a prefix is not termination");
      const fromUs = starts[0]!.atUs, toUs = stops[0]!.atUs;
      if (toUs < fromUs) fail("Reversed allocation lifecycle interval");
      if (!a.tariff || a.tariff.provenance !== "provider-fact" || !sameScope(a.scope, a.tariff.scope)) throw Error("Missing or unsupported exact provider/product/location/OS/tenancy/purchase tariff");
      const usage: Usage = { id: `${a.id}@${fromUs}`, resource: a.host, meter: "instance-us", fromUs, toUs,
        quantity: { numerator: String(toUs - fromUs), denominator: "1" }, scope: a.scope, basis: "derived",
        provenance: [...a.provenance, ...events.map(e => `${e.id}:${e.kind}@${e.atUs}`), "Explicit modeled allocation boundaries; process crash/retry does not terminate allocation"] };
      // Validate every quote and row before exposing any covered charge.
      const priced = estimate(a.tariff, [usage], evidence.window);
      if (priced.kind === "Unknown") fail(priced.reason);
      rows.push(usage); prices.push(a.tariff);
    }
    // The same physical host cannot be charged twice through shared roles or
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
