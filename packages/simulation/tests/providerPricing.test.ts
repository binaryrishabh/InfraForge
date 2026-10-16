import { expect, test } from "bun:test";
import type { PriceRule, Usage } from "../src/reality/provider/contracts";
import { add, compare, decimal, fraction, fromNumber, roundUsage } from "../src/reality/provider/exact";
import { estimate, sumEstimates, validatePrice } from "../src/reality/provider/pricing";
import { counterDelta, occupancy } from "../src/reality/provider/usage";
import { providerFixture } from "./providerFixture";
import { readFileSync } from "node:fs";
const window = { from: "2026-10-16T06:00:00Z", to: "2026-10-16T07:00:00Z", complete: true };
const basePrice = providerFixture().snapshot.prices[0]!;
function row(q: number, id = "session"): Usage {
  return {
    id,

    resource: id,

    meter: "instance-us",

    quantity: fromNumber(q),

    fromUs: 0,

    toUs: q,

    scope: basePrice.scope,

    provenance: ["authored independent billing boundary vector"],

    basis: "authored"
  };
}
const price = (): PriceRule => JSON.parse(JSON.stringify(basePrice));
test("exact decimal/rational arithmetic and bounded invalid values", () => {
  expect(add(decimal("0.1"), decimal("0.2"))).toEqual(decimal("0.3"));

  for (const value of ["NaN", "-1", "1e3", "", "01", "1.", "1".repeat(200)]) expect(() => decimal(value)).toThrow();

  expect(() => fraction("1", "0")).toThrow();

  expect(() => fromNumber(0.1)).toThrow();

  expect(roundUsage(fraction("60000001"), "1000000", "60000000")).toEqual(fraction("61000000"));
});
test("public EC2 quote bills 60-second minimum separately for each allocation", () => {
  const p = price(), one = estimate(p, [row(1)], window), two = estimate(p, [row(1, "a"), row(1, "b")], window);

  expect(one.kind).toBe("Estimated");

  expect(two.kind).toBe("Estimated");

  if (one.kind !== "Estimated" || two.kind !== "Estimated") throw Error("Missing estimates");

  expect(one.amount).toEqual(decimal("0.0016"));

  expect(two.amount).toEqual(decimal("0.0032"));

  const full = estimate(p, [row(3600000000)], window);

  expect(full.kind === "Estimated" && full.amount).toEqual(decimal("0.096"));
});
test("held-out exact boundary vectors and deterministic conservation campaign", () => {
  const p = price();

  let accepted = 0;

  for (let i = 0;i < 1024;i++) {
    const us = i < 6 ? [0, 1, 59999999, 60000000, 60000001, 3599999999][i]! : (i * 104729) % 3600000000;

    const billedSeconds = Math.max(60, Math.ceil(us / 1000000));

    const result = estimate(p, [row(us)], window);

    expect(result.kind).toBe("Estimated");

    if (result.kind === "Estimated") expect(result.amount).toEqual(fraction(BigInt(billedSeconds) * 96n, 3600000n));

    accepted++;
  }

  expect(accepted).toBe(1024);
});
test("graduated tiers aggregate a complete window before tier allocation", () => {
  const p: PriceRule = {
    ...price(),

    id: "authored.operations",

    source: "authored:graduated-verification/1",
    policySources: ["authored:graduated-verification/1"],

    scope: {
      provider: "authored",

      service: "verification",

      product: "commands",

      region: "unlocated",

      operatingSystem: "not-applicable",

      tenancy: "not-applicable",

      purchase: "authored"
    },

    exclusions: ["Synthetic arithmetic proof only; no provider claim"],

    provenance: "authored",

    meter: "operations",

    aggregation: "window",

    per: "1000",

    increment: "1",

    minimum: "0",

    tiers: [{ from: "0", to: "1000", price: "2" }, { from: "1000", to: null, price: "1" }]
  };

  const rows: Usage[] = [row(1000, "a"), row(500, "b")].map((r) => ({ ...r, meter: "operations", scope: p.scope }));

  const result = estimate(p, rows, window);

  expect(result.kind === "Estimated" && result.amount).toEqual(decimal("2.5"));

  expect(estimate(p, rows, { ...window, complete: false }).kind).toBe("Unknown");
});
test("invalid pricing, gaps, overlap, unit and unsupported provider cases fail clearly", () => {
  const patches: Array<Partial<PriceRule>> = [
    { per: "0" },

    { increment: "0" },

    { minimum: "1" },

    { currency: "usd" },

    { meter: "bytes" },

    { scope: { ...price().scope, provider: "azure" } },

    { validTo: price().validFrom },

    { tiers: [{ from: "1", to: null, price: "1" }] },

    { tiers: [{ from: "0", to: "10", price: "1" }, { from: "9", to: null, price: "1" }] },

    { tiers: [{ from: "0", to: "10", price: "-1" }] }
  ];

  for (const patch of patches) expect(() => validatePrice({ ...price(), ...patch })).toThrow();
});
test("missing usage, wrong scope, duplicates, nonconservation and price drift are Unknown", () => {
  const p = price(), r = row(1000000);

  for (const rows of [[], [r, r], [{ ...r, scope: { ...r.scope, region: "aws:aws:us-west-2" } }], [{ ...r, quantity: fraction("2") }], [r, { ...r, id: "other" }]]) expect(estimate(p, rows, window).kind).toBe("Unknown");

  expect(estimate(p, [r], { ...window, to: "2026-11-02T00:00:00Z" }).kind).toBe("Unknown");
});
test("unknown and mixed currency totals never become zero", () => {
  const a = estimate(price(), [row(1)], window);

  expect(sumEstimates([]).kind).toBe("Unknown");

  expect(sumEstimates([a, { kind: "Unknown", reason: "storage unpriced", provenance: ["storage"] }]).kind).toBe("Unknown");

  if (a.kind === "Estimated") expect(sumEstimates([a, { ...a, currency: "EUR" }]).kind).toBe("Unknown");

  expect(sumEstimates([a, a]).kind).toBe("Unknown");
});
test("occupancy integrates exact mutations and conserves byte-time across cut windows", () => {
  const events = [{ id: "put", atUs: 10, bytes: "20" }, { id: "delete", atUs: 20, bytes: "0" }];

  const all = occupancy("10", events, 0, 30);

  expect(all).toEqual(fraction("300"));

  expect(add(occupancy("10", events.filter((e) => e.atUs <= 15), 0, 15), occupancy("10", events, 15, 30))).toEqual(all);

  expect(() => occupancy("10", [...events].reverse(), 0, 30)).toThrow();

  expect(() => occupancy("10", [events[0]!, events[0]!], 0, 30)).toThrow();
});
test("counter resets/unknown epochs do not create negative or fabricated usage", () => {
  expect(counterDelta({ epoch: "a", value: "100" }, { epoch: "a", value: "120" })).toEqual({ kind: "Observed", quantity: fraction("20") });

  expect(counterDelta({ epoch: "a", value: "100" }, { epoch: "b", value: "120" }).kind).toBe("Unknown");

  expect(counterDelta({ epoch: "a", value: "100" }, { epoch: "a", value: "20" }).kind).toBe("Unknown");

  expect(compare(fraction("1", "3"), fraction("2", "6"))).toBe(0);
});
test("separately retained held-out analytic vectors match the scoped public quote", () => {
  const vectors = JSON.parse(readFileSync(new URL("../../../docs/reality/m2i-heldout-billing.json", import.meta.url), "utf8")) as {
    sourceRateCode: string;

    cases: Array<{
      name: string;

      durationsUs: number[];

      usd: {
        numerator: string;

        denominator: string
      }
    }>
  };

  expect(vectors.sourceRateCode).toBe(basePrice.id);

  for (const c of vectors.cases) {
    const result = estimate(price(), c.durationsUs.map((us, i) => row(us, `${c.name}-${i}`)), window);

    expect(result.kind).toBe("Estimated");

    if (result.kind === "Estimated") expect(result.amount).toEqual(c.usd);
  }
});
