import { expect, test } from "bun:test";
import { asyncSettingsError } from "@infraforge/domain/resource";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema } from "../zod_schemas/layout.schema";
import { challengeSeed } from "../challenges/registry";
import { definition } from "./challengeHarness";

const d = definition("hold-slots-on-a-slow-call");
const capture = (wait: number | undefined) => {
  const s = structuredClone(d.starter!), w = s.resources.find(r => r.id === "worker")!; w.asyncWorker = {...w.asyncWorker!, externalWaitMs: wait};
  if (wait === undefined) delete w.asyncWorker.externalWaitMs;
  return captureRunInputs(s, d.workload, challengeSeed(d));
};
test("external wait is optional, bounded and captured as worker-wait/1 only when saved", () => {
  expect(capture(undefined).adapterProfiles).not.toContain("worker-wait/1");
  expect(capture(0).adapterProfiles).toContain("worker-wait/1");
  expect(capture(450).adapterProfiles.filter(p => p === "worker-wait/1")).toHaveLength(1);
  for (const bad of [-1, 60001, 1.5, NaN, Infinity]) expect(asyncSettingsError("Virtual Machine", undefined, {enabled: true, concurrency: 1, prefetch: 1, cpuMsPerJob: 50, externalWaitMs: bad})).toBeDefined();
  expect(asyncSettingsError("Virtual Machine", undefined, {enabled: true, concurrency: 1, prefetch: 1, cpuMsPerJob: 50, externalWaitMs: 60000})).toBeUndefined();
  const layout = {resources: d.starter!.resources, connectionLines: d.starter!.connectionLines};
  expect(LayoutSchema.safeParse(layout).success).toBe(true);
  const bad = structuredClone(layout); bad.resources.find(r => r.id === "worker")!.asyncWorker!.externalWaitMs = 60001;
  expect(LayoutSchema.safeParse(bad).success).toBe(false);
});
test("compiled worker wait follows saved intent and refuses missing, duplicate or orphaned profiles", () => {
  const wait = (c: ReturnType<typeof buildContractFromRunInputs>) => JSON.stringify(c).includes("worker-wait/1");
  expect(wait(buildContractFromRunInputs(capture(undefined), 40))).toBe(false);
  expect(wait(buildContractFromRunInputs(capture(450), 40))).toBe(true);
  const marked = JSON.parse(JSON.stringify(capture(450)));
  expect(buildContractFromRunInputs(readRunInputs({...marked, adapterProfiles: marked.adapterProfiles.filter((p: string) => p !== "worker-wait/1")}), 40)).toHaveProperty("refused");
  expect(() => readRunInputs({...marked, adapterProfiles: [...marked.adapterProfiles, "worker-wait/1"]})).toThrow();
  const unmarked = JSON.parse(JSON.stringify(capture(undefined)));
  expect(buildContractFromRunInputs(readRunInputs({...unmarked, adapterProfiles: [...unmarked.adapterProfiles, "worker-wait/1"]}), 40)).toHaveProperty("refused");
});
