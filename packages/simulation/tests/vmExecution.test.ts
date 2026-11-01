import { expect, test } from "bun:test";
import { vmDesign, prepareVm } from "./vmExecution.fixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { COMPUTE_LIMITS } from "../src/model2/compute/policy";
import { VM_WORKERS_MAX } from "@infraforge/domain/resource";

for (const [field, value, engineField] of [["workers", 1, "workers"], ["queuedRequests", 0, "queueCapacity"]] as const) test(`saved VM ${field} replaces the frozen canvas default`, () => {
  const d = vmDesign(); Object.assign(d.resources[0]!, { vmExecution: { version: 1, [field]: value } });
  const f = prepareVm(d), app = f.compiled.input.resources.find(r => r.id === "app");
  expect(app).toMatchObject({ kind: "compute", [engineField]: { value }, workers: { value: field === "workers" ? value : 4 }, queueCapacity: { value: field === "queuedRequests" ? value : 256 }, cores: { value: 1 } });
});

test("empty settings retain historical bytes and worker bound matches the executor", () => {
  expect(VM_WORKERS_MAX).toBe(COMPUTE_LIMITS.workers);
  const d = vmDesign(), old = prepareVm(d); d.resources[0]!.vmExecution = { version: 1 };
  const next = prepareVm(d);
  expect(next.contract).toEqual(old.contract); expect(next.compiled).toEqual(old.compiled); expect(next.assumptions).toEqual(old.assumptions);
  expect(currentAdapterProfiles(d.resources)).not.toContain("vm-execution/1");
});

test("saved intent requires a matching captured profile and untampered primary limits", () => {
  const d = vmDesign(); d.resources[0]!.vmExecution = { version: 1, workers: 2, queuedRequests: 3 };
  expect(currentAdapterProfiles(d.resources)).toEqual(["vm-execution/1"]);
  for (const adapterProfiles of [[], ["vm-execution/1", "vm-execution/1"]] as const) expect(contractFromDesign(d, { adapterProfiles })).toHaveProperty("refused");
  expect(contractFromDesign(vmDesign(), { adapterProfiles: ["vm-execution/1"] })).toHaveProperty("refused");
  const missing = prepareVm(d); missing.contract.version = missing.contract.version.replace("/vm-execution/1", "");
  expect(compileProduct(d, missing.contract).ok).toBe(false);
  for (const field of ["workers", "queueCapacity"] as const) {
    const f = prepareVm(d), app = f.contract.nodes.app!.resources.find(r => r.role === "main")!.config;
    if (app.kind !== "compute") throw Error("Expected compute");
    const limit = app[field]; if (limit.kind !== "known") throw Error("Expected known limit"); limit.value++;
    const fact = f.contract.ledger.find(e => e.id === limit.provenance[0])!.quantity;
    if (fact.kind !== "known") throw Error("Expected numeric fact"); fact.value++;
    const result = compileProduct(d, f.contract);
    expect(result.ok).toBe(false); expect(result.diagnostics.some(e => e.message.includes("VM worker and queue limits must match"))).toBe(true);
  }
});

test("async worker intent refuses at adapter and compiler while publisher helpers keep defaults", () => {
  const d = vmDesign("async"), old = prepareVm(d);
  for (const vmExecution of [{ version: 1 as const }, { version: 1 as const, workers: 1 }, { version: 1 as const, queuedRequests: 0 }]) {
    d.resources.find(r => r.id === "worker")!.vmExecution = vmExecution;
    const built = contractFromDesign(d);
    expect(built).toHaveProperty("refused");
    const c = compileProduct(d, old.contract);
    expect(c.ok).toBe(false); expect(c.diagnostics.some(e => e.code === "INVALID_VM_EXECUTION")).toBe(true);
  }
  delete d.resources.find(r => r.id === "worker")!.vmExecution;
  d.resources.find(r => r.id === "app")!.vmExecution = { version: 1, workers: 1, queuedRequests: 0 };
  const f = prepareVm(d);
  expect(f.compiled.input.resources.find(r => r.id === "app")).toMatchObject({ kind: "compute", workers: { value: 1 }, queueCapacity: { value: 0 } });
  for (const id of ["app/publisher", "worker"]) {
    const before = old.compiled.input.resources.find(r => r.id === id)!;
    expect(f.compiled.input.resources.find(r => r.id === id)).toEqual(before);
  }
});

test("autoscaled main replicas use saved limits and their helper roles retain historical defaults", () => {
  const d = vmDesign("autoscaled"), old = prepareVm(d);
  d.resources.find(r => r.id === "app")!.vmExecution = { version: 1, workers: 2, queuedRequests: 0 };
  const f = prepareVm(d);
  for (let slot = 0; slot < 3; slot++) expect(f.compiled.input.resources.find(r => r.id === `app#${slot}`)).toMatchObject({ kind: "compute", workers: { value: 2 }, queueCapacity: { value: 0 } });
  for (const helper of f.compiled.input.resources.filter(r => r.id.includes("/"))) expect(helper).toEqual(old.compiled.input.resources.find(r => r.id === helper.id)!);
});
