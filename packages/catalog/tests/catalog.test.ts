import { describe, expect, test } from "bun:test";
import { CATALOG, findSku, skusFor } from "../src/index";
import {
  CATALOG_SNAPSHOT_DATE,
  PROVIDERS,
  type ProviderId,
  type SkuCategory,
} from "../src/catalog.types";
import snapshot from "./fixtures/catalog.snapshot.json";

const groups: { provider: ProviderId; category: SkuCategory; ids: string[] }[] = [
  {
    provider: "aws",
    category: "Virtual Machine",
    ids: [
      "t3.micro", "t3.small", "t3.medium", "t3.large", "m5.large",
      "m5.xlarge", "m5.2xlarge", "c5.large", "c5.xlarge", "r5.large",
    ],
  },
  {
    provider: "aws",
    category: "Database",
    ids: [
      "db.t3.micro", "db.t3.small", "db.t3.medium", "db.m5.large",
      "db.m5.xlarge", "db.m5.2xlarge", "db.r5.large",
    ],
  },
  {
    provider: "digitalocean",
    category: "Virtual Machine",
    ids: [
      "s-1vcpu-512mb-10gb", "s-1vcpu-1gb", "s-1vcpu-2gb", "s-2vcpu-2gb",
      "s-2vcpu-4gb", "s-4vcpu-8gb", "s-8vcpu-16gb", "c-2", "c-4",
    ],
  },
  {
    provider: "digitalocean",
    category: "Database",
    ids: [
      "db-s-1vcpu-1gb", "db-s-1vcpu-2gb", "db-s-2vcpu-4gb",
      "db-s-4vcpu-8gb", "db-s-6vcpu-16gb", "gd-2vcpu-8gb",
    ],
  },
];

describe("catalog snapshot", () => {
  test("preserves every SKU field and the catalog order", () => {
    expect<unknown>(CATALOG).toEqual(snapshot.skus);
    expect(CATALOG).toHaveLength(32);
    expect(new Set(CATALOG.map(sku => sku.skuId)).size).toBe(CATALOG.length);
    expect(CATALOG.map(sku => sku.skuId)).toEqual(groups.flatMap(group => group.ids));
  });

  test("preserves the snapshot date and provider metadata on both entrypoints", async () => {
    const root = await import("../src/index");
    expect(CATALOG_SNAPSHOT_DATE).toBe(snapshot.snapshotDate);
    expect<unknown>(PROVIDERS).toEqual(snapshot.providers);
    expect(root.CATALOG_SNAPSHOT_DATE).toBe(CATALOG_SNAPSHOT_DATE);
    expect(root.PROVIDERS).toBe(PROVIDERS);
  });
});

describe("SKU lookup", () => {
  test("returns the catalog object for every exact SKU identity", () => {
    for (const sku of CATALOG) {
      expect(findSku(sku.skuId)).toBe(sku);
    }
  });

  test("does not normalize or invent unknown identities", () => {
    for (const skuId of ["", "unknown", "T3.MICRO", " t3.micro", "t3.micro ", "constructor", "__proto__"]) {
      expect(findSku(skuId)).toBeUndefined();
    }
  });
});

describe("provider and category filtering", () => {
  for (const { provider, category, ids } of groups) {
    test(`${provider} ${category} preserves identities, fields and order`, () => {
      const skus = skusFor(provider, category);
      expect(skus.map(sku => sku.skuId)).toEqual(ids);
      expect<unknown>(skus).toEqual(snapshot.skus.filter(sku => ids.includes(sku.skuId)));
      for (const sku of skus) {
        expect(sku.provider).toBe(provider);
        expect(sku.category).toBe(category);
        expect(findSku(sku.skuId)).toBe(sku);
      }
    });
  }

  test("returns a fresh result array while keeping catalog object identities", () => {
    const first = skusFor("aws", "Virtual Machine");
    const second = skusFor("aws", "Virtual Machine");
    expect(first).not.toBe(second);
    expect(first[0]).toBe(second[0]);
    first.pop();
    expect(second).toHaveLength(10);
    expect(skusFor("aws", "Virtual Machine")).toHaveLength(10);
    expect(CATALOG).toHaveLength(32);
  });
});
