import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { findSku } from "@infraforge/catalog";
import { modeledResourceSizing } from "../src/capacity";
import { requireKnown } from "../src/reality/quantity";
import { createProductModel2 } from "../src/model2/product/run";
import { sizingResources, prepareSizing } from "./resourceSizing.fixture";

for (const resource of sizingResources) test(`shared sizing matches compiled CPU: ${resource.type} ${resource.skuId ?? resource.size ?? "default"}`, () => {
  const f = prepareSizing(resource), engine = f.compiled.input.resources.find(r => r.id === resource.id);
  const execution = engine?.kind === "compute" ? engine : engine?.kind === "relational" ? engine.execution : undefined;
  if (!execution) throw Error("Missing compiled execution resource");
  const expected = resource.skuId ? findSku(resource.skuId)!.vCpu : { small: 1, medium: 2, large: 4 }[resource.size ?? "small"];
  expect(requireKnown(execution.cores, "cores")).toBe(expected);
  expect(modeledResourceSizing(resource)?.cores).toBe(expected);
  expect(execution.quota).toBeUndefined();
});

// Captured before extracting the sizing helper on cfce75ed22b768750193f52d69cbe212d250140a. These are regression
// pins for educational engine artifacts, not published lab/provider measurements.
test("all catalog and generic engine artifacts and real one-second results remain byte-identical", () => {
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value).replaceAll("\r\n", "\n")).digest("hex");
  const rows = sizingResources.map(resource => {
    const f = prepareSizing(resource), runtime = createProductModel2(f.compiled);
    runtime.advanceTo(1000000);
    return [hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(runtime.evidence())];
  });
  expect(rows).toHaveLength(40);
  expect([0, 1, 2, 3].map(i => hash(rows.map(row => row[i])))).toEqual([
    "dcf11cb4d255e8978e79333b009ea625349997b8e90aa09070b2baff6b2c8cf3",
    "a8c240cdd45a9b6a9920e58693c002844a6597e190aea7db51307271564bff9e",
    "716af5d35bec703197d82b8e1fd0871cf08e76d030c1f6d739a32e6d1c141553",
    "ca2fa344eec0f0f591b47dacba666590bdce79f05257d3decff8f233d49352e3",
  ]);
});

test("unresolved and wrong-category SKU sizing remains unknown", () => {
  for (const skuId of ["missing-sku", "db.t3.micro"]) expect(modeledResourceSizing({ type: "Virtual Machine", skuId })).toBeNull();
});
