import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";
import type { ProductContract, SavedProductDesign } from "../src/model2/product/contracts";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { withRunLength } from "../src/model2/product/runContract";
import { createProductModel2 } from "../src/model2/product/run";

export function multiLbDesign(branches = 2, rootLb = false): SavedProductDesign {
  const resources: Resource[] = [{ id: "front", type: "Virtual Machine", x: 1, y: 0, size: "large", vmExecution: { version: 1, workers: 128, queuedRequests: 256 }, applicationFlow: {
    schema: "application-flow/1", operations: { read: { steps: [{ id: "cpu", kind: "compute" }, ...(branches === 1 ? [{ id: "service", kind: "call" as const, edge: "front-lb-0" }] : [{ id: "services", kind: "parallel" as const, wait: "all" as const, branches: Array.from({ length: branches }, (_, i) => ({ id: `branch-${i}`, kind: "call" as const, edge: `front-lb-${i}` })) }])] } },
  } }];
  const connections: SavedProductDesign["connections"] = [];
  const edge = (source: Resource, target: Resource, id: string) => connections.push({ id, sourceId: source.id, sourceType: source.type, targetId: target.id, targetType: target.type, port: RESOURCE_PORTS[target.type] });
  for (let i = 0; i < branches; i++) {
    const lb: Resource = { id: `lb-${i}`, type: "Load Balancer", x: 2, y: i, lbSelection: { version: 1, policy: i % 2 ? "least-outstanding" : "round-robin" }, lbAdmission: { version: 1, maxActive: 32 + i, maxQueued: 8 + i, queueWaitMs: 100 + i }, lbHealth: { version: 1, intervalSeconds: 1 + i, timeoutSeconds: 1 } };
    const vm: Resource = { id: `vm-${i}`, type: "Virtual Machine", x: 3, y: i, size: "large", vmExecution: { version: 1, workers: 16 + i, queuedRequests: 32 + i }, vmCpuQuota: { version: 1, limitPercent: 100 - i * 10 } };
    resources.push(lb, vm); edge(resources[0]!, lb, `front-lb-${i}`); edge(lb, vm, `backend-${i}`);
  }
  if (rootLb) {
    const root: Resource = { id: "entry", type: "Load Balancer", x: 0, y: 0, lbSelection: { version: 1, policy: "round-robin" }, lbAdmission: { version: 1, maxActive: 256, maxQueued: 256 } };
    resources.unshift(root); edge(root, resources.find(r => r.id === "front")!, "entry-front");
  }
  return { schema: "infraforge-saved-design/1", resources, connections, workload: { targetThroughput: 6000, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light" } };
}

export function prepareMultiLb(design = multiLbDesign(), seconds = 3, mutate?: (c: ProductContract) => void) {
  const built = contractFromDesign(design);
  if ("refused" in built) throw Error(JSON.stringify(built.refused));
  const contract = withRunLength(built.contract, seconds, "multi-lb-proof");
  contract.lbAccountingProfile = "lb-accounting/1";
  contract.limits.maxRawResults = 100000;
  contract.limits.maxTraceRows = 100000;
  mutate?.(contract);
  const compiled = compileProduct(design, contract);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  return { design, contract, compiled: compiled.value, runtime: createProductModel2(compiled.value) };
}
