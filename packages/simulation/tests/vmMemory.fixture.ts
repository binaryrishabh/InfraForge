import type { VmMemory } from "@infraforge/domain/resource";
import type { ComputeState } from "../src/model2/compute/contracts";
import type { CausalObserver } from "../src/model2/workload/causal";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { vmDesign } from "./vmExecution.fixture";
import { prepareKeyspace } from "./keyspace.fixture";

export function memoryDesign(lb = false, memory?: VmMemory) {
  const d = vmDesign("flow"); delete d.resources[0]!.applicationFlow;
  Object.assign(d.resources[0]!, { vmExecution: { version: 1, workers: 1, queuedRequests: 1000 }, ...(memory ? { vmMemory: memory } : {}) });
  if (lb) {
    d.resources.unshift({ id: "lb", type: "Load Balancer", x: 0, y: 0, lbAdmission: { version: 1, maxActive: 128, maxQueued: 128, queueWaitMs: 1000 } });
    d.connections.push({ id: "lb-app", sourceId: "lb", sourceType: "Load Balancer", targetId: "app", targetType: "Virtual Machine", port: 80 });
  }
  d.workload.targetThroughput = 36000; d.workload.readWriteRatio = 1;
  return d;
}
export const tightMemory: VmMemory = { version: 1, baselineMiB: 1024, requestMiB: 128, activeMiB: 0 };
export function prepareMemory(lb = false, memory?: VmMemory, observe?: CausalObserver) {
  const design = memoryDesign(lb, memory), f = prepareKeyspace(design, "memory-proof");
  const make = (observer?: CausalObserver) => createProductModel2(f.compiled, undefined, observer);
  return { ...f, design, make, runtime: make(observe) };
}
export const memoryState = (runtime: ReturnType<typeof createProductModel2>) => runtime.inspect("app") as ComputeState;
export function recompileMemory(f: ReturnType<typeof prepareMemory>) {
  const c = compileProduct(f.design, f.contract); if (!c.ok) throw Error(JSON.stringify(c.diagnostics)); return c.value;
}
