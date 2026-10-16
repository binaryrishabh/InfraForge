import type { Estimate, PriceRule, Scope, Usage } from "./contracts";
import { add, compare, decimal, fraction, multiply, rational, roundUsage, subtract } from "./exact";
import { bounded, timestamp } from "./validity";
const scopeFields = ["provider", "service", "product", "region", "operatingSystem", "tenancy", "purchase"] as const;
export function sameScope(a: Scope, b: Scope) {
  return scopeFields.every((k) => typeof a[k] === "string" && !!a[k] && a[k] === b[k]);
}
export function validatePrice(p: PriceRule) {
  bounded(p);
  if (!Array.isArray(p.policySources) || !p.policySources.length || p.policySources.some((s) => !s)) throw Error("Billing policy provenance required separately from the price quote");
  if (!p.id || !p.version || !p.source || !["provider-fact", "authored"].includes(p.provenance) || !["instance-us", "byte-us", "operations", "bytes"].includes(p.meter) || !/^[A-Z]{3}$/.test(p.currency) || !["session", "window"].includes(p.aggregation) || !sameScope(p.scope, p.scope) || !p.exclusions.length) throw Error("Unsupported/incomplete pricing contract");

  if (timestamp(p.validFrom) >= timestamp(p.validTo)) throw Error("Empty pricing validity window");

  const per = fraction(p.per), step = fraction(p.increment), min = fraction(p.minimum);

  if (per.numerator === "0" || step.numerator === "0" || BigInt(min.numerator) % BigInt(step.numerator)) throw Error("Invalid pricing unit/increment/minimum");

  if (!p.tiers.length || p.tiers.length > 64 || p.tiers[0]!.from !== "0") throw Error("Pricing tiers must begin at zero");

  for (const [i, tier] of p.tiers.entries()) {
    fraction(tier.from);

    decimal(tier.price);

    if (tier.to !== null && compare(fraction(tier.to), fraction(tier.from)) <= 0) throw Error("Empty/reversed pricing tier");

    if (i === p.tiers.length - 1 ? tier.to !== null : tier.to === null || tier.to !== p.tiers[i + 1]!.from) throw Error("Pricing tier gap/overlap or missing unbounded tail");
  }

  if (p.provenance === "provider-fact" && (p.scope.provider !== "aws" || p.scope.service !== "AmazonEC2" || p.scope.operatingSystem !== "Linux" || p.scope.tenancy !== "Shared" || p.scope.purchase !== "OnDemand" || p.scope.product !== "m5.large" || p.meter !== "instance-us" || p.currency !== "USD" || p.per !== "3600000000" || p.increment !== "1000000" || p.minimum !== "60000000" || p.aggregation !== "session" || p.tiers.length !== 1)) throw Error("Provider billing adapter only supports scoped Linux shared On-Demand m5.large instance time");
}
export function estimate(p: PriceRule, rows: Usage[], window: {
  from: string;

  to: string;

  complete: boolean
}): Estimate {
  validatePrice(p);

  let provenance = [p.source, ...p.policySources, `${p.id}@${p.version}`];

  const unknown = (reason: string): Estimate => ({ kind: "Unknown", reason, provenance });

  const from = timestamp(window.from), to = timestamp(window.to);

  if (to <= from || from < timestamp(p.validFrom) || to > timestamp(p.validTo)) return unknown("Usage window outside a single applicable price version; split/review price changes explicitly");

  if (!window.complete) return unknown("Aggregation window incomplete; tiers/minimum cannot be silently prorated");

  if (!rows.length || rows.length > 10000 || new Set(rows.map((r) => r.id)).size !== rows.length) return unknown("Missing, duplicate or over-budget usage");

  const references = new Set(provenance);
  let referenceCharacters = 0;
  for (const r of rows) {
    if (r.id.length > 160 || r.resource.length > 160 || r.provenance.length > 16 || r.provenance.some((s) => typeof s !== "string" || !s || s.length > 512)) return unknown("Usage metadata budget exceeded");
    for (const source of r.provenance) {
      referenceCharacters += source.length;
      if (referenceCharacters > 2000000) return unknown("Usage provenance character budget exceeded");
      references.add(source);
    }
    if (!r.id || !r.resource || !r.provenance.length || !["observed-model", "authored", "derived"].includes(r.basis) || r.meter !== p.meter || !sameScope(r.scope, p.scope) || !Number.isSafeInteger(r.fromUs) || !Number.isSafeInteger(r.toUs) || r.fromUs < 0 || r.toUs < r.fromUs || r.toUs > (to - from) * 1000) return unknown("Usage identity, units, scope, evidence or interval incompatible with price");

    rational(r.quantity);

    if (p.meter === "instance-us" && compare(r.quantity, fraction(String(r.toUs - r.fromUs)))) return unknown("Instance-time quantity does not conserve its lifecycle interval");
  }
  provenance = [...references];

  const sessions = new Map<string, Usage[]>();

  if (p.aggregation === "session") for (const r of rows) {
    const group = sessions.get(r.resource) ?? [];

    group.push(r);

    sessions.set(r.resource, group);
  }

  for (const group of sessions.values()) {
    group.sort((a, b) => a.fromUs - b.fromUs);

    for (let i = 1;i < group.length;i++) if (group[i]!.fromUs < group[i - 1]!.toUs || group[i]!.fromUs === group[i - 1]!.fromUs) return unknown("Overlapping/duplicate allocation sessions");
  }

  let amount = fraction(0n);

  const groups = p.aggregation === "session" ? rows.map((r) => r.quantity) : [rows.reduce((v, r) => add(v, r.quantity), fraction(0n))];

  for (const raw of groups) {
    const q = roundUsage(raw, p.increment, p.minimum);

    for (const tier of p.tiers) {
      const start = fraction(tier.from);

      if (compare(q, start) <= 0) break;

      const end = tier.to === null || compare(q, fraction(tier.to)) < 0 ? q : fraction(tier.to);

      amount = add(amount, multiply(subtract(end, start), multiply(decimal(tier.price), fraction(1n, p.per))));
    }
  }

  return {
    kind: "Estimated",

    currency: p.currency,

    amount,

    rule: `${p.id}@${p.version}`,

    usage: rows.map((r) => r.id),

    provenance
  };
}
export function sumEstimates(values: Estimate[]): Estimate {
  const provenance = values.flatMap((v) => v.provenance);

  const known = values.filter((v): v is Extract<Estimate, {
    kind: "Estimated"
  }> => v.kind === "Estimated");

  const usage = known.flatMap((v) => v.usage);

  if (!values.length || known.length !== values.length || new Set(known.map((v) => v.currency)).size !== 1 || new Set(usage).size !== usage.length) return {
    kind: "Unknown",

    reason: "Incomplete components, duplicate usage or mixed currency; no zero or exchange-rate default",

    provenance
  };

  return {
    kind: "Estimated",

    currency: known[0]!.currency,

    amount: known.reduce((a, v) => add(a, v.amount), fraction(0n)),

    rule: "sum-same-currency/1",

    usage: known.flatMap((v) => v.usage),

    provenance
  };
}
