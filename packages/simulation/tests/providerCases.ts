import { compileProviderProduct } from "../src/reality/provider/compile";
import { digest } from "../src/reality/provider/fingerprint";
import { estimate } from "../src/reality/provider/pricing";
import { fraction, fromNumber } from "../src/reality/provider/exact";
import type { Usage } from "../src/reality/provider/contracts";
import { providerFixture, providerHasher } from "./providerFixture";

export function billingCampaign() {
  const f = providerFixture(), price = f.snapshot.prices[0]!, results: unknown[] = [];

  for (let i = 0;i < 1024;i++) {
    const duration = i < 6 ? [0, 1, 59999999, 60000000, 60000001, 3599999999][i]! : i * 104729 * 7919 % 3600000000;

    const row: Usage = {
      id: `session-${i}`,

      resource: `host-${i}`,

      meter: "instance-us",

      fromUs: 0,

      toUs: duration,

      quantity: fromNumber(duration),

      scope: price.scope,

      basis: "authored",

      provenance: ["Deterministic arithmetic verification vector; not cloud performance measurement"]
    };

    const r = estimate(price, [row], { from: "2026-10-16T06:00:00Z", to: "2026-10-16T07:00:00Z", complete: true });

    const reference = fraction(BigInt(Math.max(60, Math.ceil(duration / 1000000))) * 96n, 3600000n);

    if (r.kind !== "Estimated" || JSON.stringify(r.amount) !== JSON.stringify(reference)) throw Error(`Billing conservation failure at ${i}`);

    results.push([duration, r.amount]);
  }

  return { count: results.length, failures: 0, digest: digest(results, providerHasher) };
}
export function providerCampaign() {
  const result: unknown[] = [];

  let valid = 0, refused = 0;

  for (let i = 0;i < 128;i++) {
    const f = providerFixture({ slots: 2 + i % 7, memory: [100, 4096, 16384][i % 3] });

    const negative = i >= 64, variant = i % 8;

    if (negative) {
      if (variant === 0) f.provider.snapshot = "unknown-version";

      if (variant === 1) f.provider.hosts[0]!.placements[0]!.location = "us-east-1a";

      if (variant === 2) f.provider.hosts[0]!.roles.pop();

      if (variant === 3) f.provider.hosts[0]!.fact = "unknown-fact";

      if (variant === 4) f.provider.asOf = "2027-01-01T00:00:00Z";

      if (variant === 5) f.snapshot.instances[0]!.vCpu++;

      if (variant === 6) f.provider.hosts[0]!.roles[0]!.memory = f.q.q(`bad.memory.${i}`, 9 * 1024 ** 3, "bytes");

      if (variant === 7) f.provider.hosts[0]!.price = "unknown-price";
    }

    try {
      const c = compileProviderProduct(f, f.provider, f.snapshot, providerHasher);

      if (negative) throw Error(`Negative compiler case accepted ${i}`);

      valid++;

      result.push([i, "valid", c.fingerprint]);
    } catch (cause) {
      if (!negative || String(cause).includes("case accepted")) throw cause;

      refused++;

      result.push([i, "refused", variant]);
    }
  }

  return { count: result.length, valid, refused, digest: digest(result, providerHasher) };
}
