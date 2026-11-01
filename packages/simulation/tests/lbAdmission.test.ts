import { expect, test } from "bun:test";
import { lbDesign, prepareLb } from "./lbAdmission.fixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";

test("saved admission maps partial controls to real engine gates and empty intent preserves bytes", () => {
  for (const setting of [{ version: 1 as const, maxActive: 1 }, { version: 1 as const, maxQueued: 0 }, { version: 1 as const, queueWaitMs: 1 }]) {
    const d = lbDesign(); d.resources[0]!.lbAdmission = setting;
    expect(prepareLb(d).compiled.input.resources.find(r => r.kind === "load-balancer")).toMatchObject({ maxOutstanding: { value: setting.maxActive ?? 1024 }, maxPending: { value: setting.maxQueued ?? 256 }, pendingTimeout: { value: (setting.queueWaitMs ?? 1000) * 1000 } });
  }
  const d = lbDesign(), old = prepareLb(d); d.resources[0]!.lbAdmission = { version: 1 };
  const next = prepareLb(d);
  expect(next.contract).toEqual(old.contract); expect(next.compiled).toEqual(old.compiled); expect(next.assumptions).toEqual(old.assumptions);
});

test("admission requires matching captured profile and untampered materialized gates", () => {
  const d = lbDesign(); d.resources[0]!.lbAdmission = { version: 1, maxActive: 1, maxQueued: 2, queueWaitMs: 10 };
  expect(currentAdapterProfiles(d.resources)).toEqual(["lb-admission/1"]);
  for (const adapterProfiles of [[], ["lb-admission/1", "lb-admission/1"]] as const) expect(contractFromDesign(d, { adapterProfiles })).toHaveProperty("refused");
  expect(contractFromDesign(lbDesign(), { adapterProfiles: ["lb-admission/1"] })).toHaveProperty("refused");
  const missing = prepareLb(d); missing.contract.version = missing.contract.version.replace("/lb-admission/1", "");
  expect(compileProduct(d, missing.contract).ok).toBe(false);
  for (const field of ["maxOutstanding", "maxPending", "pendingTimeout"] as const) {
    const f = prepareLb(d), lb = f.contract.nodes.lb!.resources.find(r => r.config.kind === "load-balancer")!.config;
    if (lb.kind !== "load-balancer") throw Error("Expected load balancer");
    const gate = lb[field]; if (gate.kind !== "known") throw Error("Expected known admission gate"); gate.value++;
    const fact = f.contract.ledger.find(r => r.id === gate.provenance[0])!.quantity;
    if (fact.kind !== "known") throw Error("Expected admission fact"); fact.value++;
    const result = compileProduct(d, f.contract);
    expect(result.ok).toBe(false); expect(result.diagnostics.some(r => r.message.includes("Load balancer admission gates must match"))).toBe(true);
  }
});
