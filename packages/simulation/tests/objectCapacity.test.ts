import { expect, test } from "bun:test";
import { objectSetup } from "./objectCapacity.fixture";
import { currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";

test("explicit object capacity materializes exact bytes and captures its profile", () => {
  const f = objectSetup("upload", 1);
  expect(currentAdapterProfiles(f.saved.resources)).toEqual(["object-capacity/1"]);
  expect(f.compiled.input.resources.find(r => r.id === "store")).toMatchObject({ capacity: { value: 1048576 } });
  expect(f.contract.ledger.find(r => r.id === "store.main.capacity")).toMatchObject({ classification: "derived", formula: "1 * 1048576", provenance: [expect.objectContaining({ source: "saved-design:store.objectStoragePolicy.capacityMiB" })] });
});

test("capacity requires exactly one matching captured and owned profile", () => {
  const f = objectSetup("upload", 1);
  for (const adapterProfiles of [[], ["monitor-buffer/1"], ["object-capacity/1", "object-capacity/1"]] as const) expect(contractFromDesign(f.saved, { adapterProfiles })).toHaveProperty("refused");
  expect(contractFromDesign(objectSetup().saved, { adapterProfiles: ["object-capacity/1"] })).toHaveProperty("refused");
  for (const version of ["canvas-assumptions/2", "canvas-assumptions/2/object-capacity/2", "canvas-assumptions/2/object-capacity/10", "canvas-assumptions/2/object-capacity/1/object-capacity/1"]) for (const owned of [true, false]) {
    const contract = structuredClone(f.contract);
    if (owned) contract.nodes.store!.profileVersion = version; else contract.version = version;
    expect(compileProduct(f.saved, contract).ok).toBe(false);
  }
});

test("compiler binds exact capacity even if a changed quantity has consistent ledger provenance", () => {
  const f = objectSetup("upload", 1), store = f.contract.nodes.store!.resources[0]!.config;
  if (store.kind !== "object-store" || store.capacity?.kind !== "known") throw Error("Expected capacity");
  store.capacity.value++;
  const row = f.contract.ledger.find(e => e.id === store.capacity!.provenance[0])!;
  row.quantity = store.capacity; row.formula = String(store.capacity.value);
  const result = compileProduct(f.saved, f.contract);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(JSON.stringify(result.diagnostics)).toContain("must match saved intent");
});

test("largest supported whole MiB compiles to exact safe integer bytes", () => {
  const f = objectSetup("plain", 8589934591);
  expect(f.compiled.input.resources.find(r => r.id === "store")).toMatchObject({ capacity: { value: 9007199253692416 } });
  expect(Number.isSafeInteger(8589934591 * 1048576)).toBe(true);
  expect(Number.isSafeInteger(8589934592 * 1048576)).toBe(false);
});
