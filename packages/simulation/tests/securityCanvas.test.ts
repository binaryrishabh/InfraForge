import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { securitySettingsError } from "@infraforge/domain/resource";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { securityDesign, prepareSecurity } from "./securityCanvas.fixture";
import pins from "./securityCanvas.pins.json";

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v).replaceAll("\r\n", "\n")).digest("hex");
test("absent security preserves pre-edit LF-normalized contract, compiled and evidence SHA-256 pins", () => {
  const designs = [securityDesign({app:"Virtual Machine"}, []), securityDesign({app:"Virtual Machine",db:"Database"}, [["app","db"]]), securityDesign()];
  for (const [i,d] of designs.entries()) {
    const p = prepareSecurity(d), r = createProductModel2(p.compiled); r.advanceTo(1000000);
    expect({contract:hash(p.contract), compiled:hash(p.compiled), evidence:hash(r.evidence())}).toEqual(pins[i]!);
  }
});
for (const ports of [[], [5433]]) test(`explicit listener ${JSON.stringify(ports)} permits a deliberate runtime no-listener`, () => {
  const d = securityDesign(); d.resources.find(r => r.id === "db")!.listenerSettings = { version: 1, ports };
  const p = prepareSecurity(d), runtime = createProductModel2(p.compiled); runtime.advanceTo(1000000);
  const e = runtime.evidence();
  expect(e.systems.security.events.rows.some(r => r.kind === "connection-denied" && r.detail === "no-listener")).toBe(true);
  expect(e.data.databases[0]!.transactions.committed).toBe(0);
  expect(e.counts.completed).toBe(0);
  const forged = structuredClone(p.contract); forged.nodes.db!.listeners = [];
  if (ports.length) expect(compileProduct(d, forged).ok).toBe(false);
});
test("invalid versions, ownership, duplicate ports/rules, scopes and ranges are refused", () => {
  for (const [type,l,f] of [
    ["Database", {version:2,ports:[]}, undefined], ["Database", {version:1,ports:[0]}, undefined],
    ["Database", {version:1,ports:[5432,5432]}, undefined], ["Firewall", {version:1,ports:[]}, undefined],
    ["Database", undefined, {version:1,default:"deny",rules:[]}], ["Firewall", undefined, {version:2,default:"deny",rules:[]}],
  ] as const) expect(securitySettingsError(type,l,f)).toBeDefined();
  const d = securityDesign(); Object.assign(d.resources.find(r => r.id === "db")!, {listenerSettings:{version:2,ports:[]}});
  expect("refused" in contractFromDesign(d)).toBe(true);
  const valid = securityDesign(), p = prepareSecurity(valid); valid.resources.find(r=>r.id === "db")!.listenerSettings = {version:1,ports:[]};
  expect(compileProduct(valid,p.contract).ok).toBe(false);
  const incomplete = prepareSecurity(securityDesign()); incomplete.contract.nodes.db!.listeners = [];
  expect(compileProduct(securityDesign(), incomplete.contract).ok).toBe(false);
});
