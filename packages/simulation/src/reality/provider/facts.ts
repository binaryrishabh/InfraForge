import type { ProviderSnapshot, Source } from "./contracts";
import { decimal, fraction } from "./exact";
import { validatePrice } from "./pricing";
import { bounded, timestamp } from "./validity";
export function sourceAt(source: Source, asOf: string) {
  const t = timestamp(asOf), retrieved = timestamp(source.retrievedAt);

  if (source.publicationDate && timestamp(source.publicationDate) > retrieved) throw Error("Publication after retrieval");

  if (t < timestamp(source.validFrom) || t > timestamp(source.reviewThrough) || t < retrieved) throw Error("Fact outside reviewed validity domain");

  if (!source.id || !/^https:\/\//.test(source.url) || !source.uncertainty.length) throw Error("Source identity/HTTPS/uncertainty required");
}
export function validateSnapshot(s: ProviderSnapshot, asOf: string) {
  bounded(s);

  if (s.schema !== "infraforge-provider-facts/1" || !s.version || s.sources.length > 64 || s.locations.length > 128 || s.instances.length > 128 || s.prices.length > 128) throw Error("Provider snapshot version/budget");

  const unique = (rows: ReadonlyArray<{
    id: string
  }>) => {
    if (new Set(rows.map((r) => r.id)).size !== rows.length || rows.some((r) => !r.id || r.id.length > 160)) throw Error("Duplicate/invalid fact identity");
  };

  for (const rows of [s.sources, s.locations, s.instances, s.prices]) unique(rows);

  const sources = new Set(s.sources.map((v) => v.id));

  s.sources.forEach((v) => sourceAt(v, asOf));

  for (const l of s.locations) if (!sources.has(l.source) || !l.provider || !l.partition || !["region", "zone"].includes(l.kind)) throw Error("Location source/provider/kind");

  for (const f of s.instances) {
    if (!sources.has(f.source) || f.provider !== "aws" || f.service !== "AmazonEC2" || !f.sku || !Number.isSafeInteger(f.vCpu) || f.vCpu < 1 || f.availability !== "regional-price-listed") throw Error("Unsupported instance fact");

    fraction(f.memoryBytes);

    if (!BigInt(f.memoryBytes)) throw Error("Positive exact memory bytes required");

    if (!s.locations.some((l) => l.id === f.region && l.kind === "region" && l.provider === f.provider)) throw Error("Instance fact region mismatch");
  }

  for (const p of s.prices) {
    validatePrice(p);
    if (!sources.has(p.source) || p.policySources.some((id) => !sources.has(id))) throw Error("Missing price or billing-policy source");

    decimal(p.tiers[0]!.price);
  }
}
