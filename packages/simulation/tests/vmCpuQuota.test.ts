import { expect, test } from "bun:test";
import { quotaDesign, prepareQuota } from "./vmCpuQuota.fixture";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { requireKnown } from "../src/reality/quantity";

test("current canvas compute has no quota unless explicitly authored", () => {
  const old = prepareQuota();
  expect(old.compiled.input.resources.find(r => r.id === "app")).not.toHaveProperty("quota");
  old.runtime.advanceTo(3000000);
  expect(old.runtime.inspect("app")).toHaveProperty("compute.cpu.quotaRemainingCoreUs", null);
});

test("saved 50% of two modeled cores binds to the real 100 ms scheduler quota", () => {
  const d = quotaDesign(); Object.assign(d.resources[0]!, { size: "medium", vmCpuQuota: { version: 1, limitPercent: 50 } });
  const f = prepareQuota(d), app = f.compiled.input.resources.find(r => r.id === "app");
  if (app?.kind !== "compute" || !app.quota) throw Error("Missing scheduler quota");
  expect(requireKnown(app.cores, "cores")).toBe(2);
  expect(requireKnown(app.quota.budget, "cpu-us")).toBe(100000);
  expect(requireKnown(app.quota.period, "us")).toBe(100000);
  delete app.quota;
  const contractApp = f.contract.nodes.app!.resources.find(r => r.role === "main")!.config;
  if (contractApp.kind !== "compute") throw Error("Missing compute");
  delete contractApp.quota;
  expect(compileProduct(d, f.contract).ok).toBe(false);
});

test("explicit quota refuses historical profile selection", () => {
  const d = quotaDesign(); Object.assign(d.resources[0]!, { vmCpuQuota: { version: 1, limitPercent: 25 } });
  expect(contractFromDesign(d, { adapterProfiles: [] })).toHaveProperty("refused");
});
