import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildInventory, root } from "../reality/inventory";
import { scanFile } from "../reality/scan";
import { classify } from "../reality/classify";
import { validateLedger } from "../../packages/simulation/src/reality/ledger";
import { requireKnown, sumQuantities, validateQuantity } from "../../packages/simulation/src/reality/quantity";
import { validateArtifacts, validateDepth } from "../reality/artifacts";
import ignore from "ignore";

test("every production numeric literal and source file is inventoried; implementation is not provider provenance", () => {
  const actual = buildInventory();
  expect(JSON.parse(readFileSync(resolve(root, "docs/reality/model1-ledger.json"), "utf8"))).toEqual(actual);
  expect(actual.ledger.length).toBeGreaterThan(2000); expect(actual.files.length).toBeGreaterThan(350);
  for (const file of ["apps/backend/lib/prisma.ts", "apps/web/src/lib/format.ts", "apps/web/src/lib/useMediaQuery.ts"])
    expect(actual.files.some((entry) => entry.file === file)).toBe(true);
  expect(validateLedger(actual.ledger)).toEqual([]);
  expect(actual.ledger.filter((e) => e.classification === "obsolete").length).toBe(2);
  expect(actual.ledger.filter((e) => e.classification !== "implementation-policy").every((e) => e.freeMode === "forbidden")).toBe(true);
});
test("scanner includes inline constants and negative/unit conversion literals without parsing comments as physics", () => {
  const sites = scanFile("packages/simulation/src/test.ts", "// 123\nconst x = -2.5 * 1_000; const y = 0x10;");
  expect(sites.map((s) => s.value)).toEqual([-2.5, 1000, 16]);
  expect(new Set(sites.map((s) => classify(s).id)).size).toBe(3);
  expect(() => scanFile("new.ts", "const newCapacity = 100n;")).toThrow("explicit ledger representation");
});
test("ledger refuses fake facts, missing provenance, unsupported Free Mode certainty and invalid units", () => {
  const entry = classify(scanFile("packages/simulation/src/test.ts", "const x = 4;")[0]!);
  expect(validateLedger([entry])).toEqual([]);
  const fake = { ...entry, classification: "provider-fact" as const, freeMode: "allowed" as const };
  expect(validateLedger([fake]).join()).toContain("external support");
  expect(validateLedger([{ ...entry, freeMode: "allowed" }]).join()).toContain("certainty");
  expect(validateLedger([{ ...entry, provenance: [] }]).join()).toContain("provenance");
  expect(validateQuantity({ kind: "known", value: NaN, unit: "count", provenance: ["x"] })).not.toEqual([]);
  expect(validateQuantity({ kind: "range", min: 5, max: 2, unit: "count", provenance: ["x"] })).not.toEqual([]);
  expect(validateQuantity({ kind: "known", value: 1, unit: "wrong" as "count", provenance: ["x"] })).toContain("Unsupported unit");
  expect(() => requireKnown({ kind: "unknown", unit: "us", provenance: ["x"], reason: "Unmeasured" }, "us")).toThrow("Unresolved");
});
test("unknown components cannot become a free zero total and epistemic bounds remain bounds", () => {
  expect(sumQuantities([{ kind: "known", value: 2, unit: "USD", provenance: ["a"] },
    { kind: "unknown", unit: "USD", provenance: ["b"], reason: "Unpriced transfer" }], "USD").kind).toBe("unknown");
  expect(sumQuantities([{ kind: "known", value: 2, unit: "USD", provenance: ["a"] },
    { kind: "range", min: 3, max: 7, unit: "USD", provenance: ["b"] }], "USD")).toMatchObject({ kind: "range", min: 5, max: 9 });
  expect(sumQuantities([], "USD").kind).toBe("unknown");
  expect(() => sumQuantities([{ kind: "known", value: 1e308, unit: "USD", provenance: ["x"] }, { kind: "known", value: 1e308, unit: "USD", provenance: ["x"] }], "USD")).toThrow("overflow");
});
test("provider fact snapshots and all eleven resource depth rows/dimensions validate", () => {
  expect(validateArtifacts(root)).toEqual([]); expect(validateDepth([])).not.toEqual([]);
});
test("audit data and internal Model-2 foundation stay outside the current runtime image", () => {
  const context = ignore().add(readFileSync(resolve(root, ".dockerignore"), "utf8"));
  for (const file of ["docs/reality/model1-ledger.json", "packages/simulation/src/model2/run.ts", "packages/simulation/src/reality/quantity.ts"])
    expect(context.ignores(file)).toBe(true);
  expect(context.ignores("packages/simulation/src/engine.ts")).toBe(false);
});
