import type { ProviderSnapshot, Source } from "./contracts";
export interface PublicPriceExtract {
  schema: string;

  source: string;

  retrievedAt: string;

  metadata: Record<string, string>;

  record: Record<string, string>;
}
export interface SourceReview {
  url: string;

  retrievedAt: string;

  publicationDate: null;

  normalizedUtf8Sha256: string
}
export function ec2Snapshot(raw: PublicPriceExtract, reviews: SourceReview[]): ProviderSnapshot {
  const r = raw.record;

  if (raw.schema !== "infraforge-public-price-extract/1" || raw.source !== "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/us-east-1/index.csv" || raw.metadata.OfferCode !== "AmazonEC2" || raw.metadata.FormatVersion !== "v1.0" || !/^\d{14}$/.test(raw.metadata.Version!)) throw Error("Unsupported public price publication");

  const required = {
    "Instance Type": "m5.large",

    TermType: "OnDemand",

    "Operating System": "Linux",

    Tenancy: "Shared",

    "Pre Installed S/W": "NA",

    CapacityStatus: "Used",

    "Region Code": "us-east-1",

    operation: "RunInstances",

    Unit: "Hrs",

    Currency: "USD",

    StartingRange: "0",

    EndingRange: "Inf",

    serviceCode: "AmazonEC2",

    "Product Family": "Compute Instance",

    "License Model": "No License required",

    vCPU: "2",

    Memory: "8 GiB"
  };

  for (const [key, value] of Object.entries(required)) if (r[key] !== value) throw Error(`Unsupported public price dimension: ${key}`);

  if (!r.SKU || r.RateCode !== `${r.SKU}.${r.OfferTermCode}.6YS6EN2CT7` || r.OfferTermCode !== "JRTCKXETXF" || !r.PricePerUnit || !/^\d{4}-\d\d-\d\d$/.test(r.EffectiveDate!)) throw Error("Missing exact public term/rate/effective date");

  const validFrom = `${r.EffectiveDate}T00:00:00Z`, reviewThrough = "2026-11-01T00:00:00Z", retrievedAt = new Date(raw.retrievedAt).toISOString();

  const source: Source = {
    id: `aws.ec2.${raw.metadata.Version}`,

    url: raw.source,

    publicationDate: raw.metadata["Publication Date"]!,

    retrievedAt,

    validFrom,

    reviewThrough,

    uncertainty: ["Reviewed snapshot of one public product, not an invoice or promise of unchanged future price", "Review-through is an authored expiry policy, not a provider effective end date"]
  };

  const review = (url: string) => {
    const row = reviews.find((s) => s.url === url);

    if (!row || !/^[a-f0-9]{64}$/.test(row.normalizedUtf8Sha256)) throw Error("Missing timestamped primary-source review");

    return {
      url,

      retrievedAt: new Date(row.retrievedAt).toISOString(),

      publicationDate: row.publicationDate,

      contentSha256: row.normalizedUtf8Sha256
    };
  };

  const policy: Source = {
    ...source,

    ...review("https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html"),

    id: "aws.ec2.billing-state",

    uncertainty: ["Documentation publication date Unknown", "Generic modeled allocation-to-EC2-running mapping must be authored separately"]
  };

  const zones: Source = {
    ...source,

    ...review("https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-availability-zones.html"),

    id: "aws.zone-identities",

    uncertainty: ["Documentation publication date Unknown", "Stable zone IDs do not prove account offering, capacity, latency or independence probabilities"]
  };

  return {
    schema: "infraforge-provider-facts/1",

    version: `aws.ec2.${raw.metadata.Version}.m5.large/1`,

    sources: [source, policy, zones],

    locations: [
      {
        id: "aws:aws:us-east-1",
        provider: "aws",
        partition: "aws",
        kind: "region",
        source: zones.id
      },

      ...["use1-az1", "use1-az2"].map((id) => ({
        id: `aws:aws:${id}`,

        provider: "aws",

        partition: "aws",

        kind: "zone" as const,

        parent: "aws:aws:us-east-1",

        source: zones.id
      }))
    ],

    instances: [
      {
        id: `aws.ec2.${r.SKU}`,

        provider: "aws",

        service: "AmazonEC2",

        sku: "m5.large",

        region: "aws:aws:us-east-1",

        vCpu: Number(r.vCPU),

        memoryBytes: String(8n * 1024n ** 3n),

        source: source.id,

        availability: "regional-price-listed"
      }
    ],

    prices: [
      {
        id: r.RateCode!,

        version: raw.metadata.Version!,

        source: source.id,
        policySources: [policy.id],

        scope: {
          provider: "aws",

          service: "AmazonEC2",

          product: "m5.large",

          region: "aws:aws:us-east-1",

          operatingSystem: "Linux",

          tenancy: "Shared",

          purchase: "OnDemand"
        },

        meter: "instance-us",

        currency: "USD",

        validFrom,

        validTo: reviewThrough,

        aggregation: "session",

        per: "3600000000",

        increment: "1000000",

        minimum: "60000000",

        tiers: [{ from: "0", to: null, price: r.PricePerUnit! }],

        provenance: "provider-fact",

        exclusions: [
          "Only Linux shared On-Demand instance usage; pending state not billed, running idle/crashed process still allocated",

          "No EBS, public IPv4, transfer, tax, savings/reserved/spot, hibernation, licensed software or account adjustments",

          `Billing minimum/increment source: ${policy.url}`,

          "Price effective-end date Unknown; validTo is the authored snapshot review expiry"
        ]
      }
    ]
  };
}
