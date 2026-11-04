import type { Resource } from "@infraforge/domain/resource";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { withRunLength } from "../src/model2/product/runContract";
import { withTimeline } from "../src/model2/product/timeline";
import { createProductModel2 } from "../src/model2/product/run";
import type { ComputeState } from "../src/model2/compute/contracts";
import type { TraceEvent } from "../src/model2/network/contracts";

export function sixVmScenario(outage: boolean) {
  const resources: Resource[] = [{ id: "entry", type: "Load Balancer", x: 0, y: 0, lbSelection: { version: 1, policy: "round-robin" }, lbHealth: { version: 1, intervalSeconds: 1, timeoutSeconds: 1, unhealthyAfter: 3 }, lbAdmission: { version: 1, maxActive: 256, maxQueued: 256 } }];
  for (let i = 0; i < 6; i++) resources.push({ id: `vm-${i}`, type: "Virtual Machine", x: 1, y: i, size: "small", vmExecution: { version: 1, workers: 2 ** i, queuedRequests: i === 0 ? 4 : 16 + i }, vmCpuQuota: { version: 1, limitPercent: [5, 20, 35, 50, 75, 100][i]! } });
  const design: SavedProductDesign = { schema: "infraforge-saved-design/1", resources, connections: resources.slice(1).map(vm => ({ id: `route-${vm.id}`, sourceId: "entry", sourceType: "Load Balancer", targetId: vm.id, targetType: "Virtual Machine", port: 80 })), workload: { targetThroughput: 21600, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light" } };
  const built = contractFromDesign(design); if ("refused" in built) throw Error(JSON.stringify(built.refused));
  const contract = withTimeline(withRunLength(built.contract, 14, "six-vm-proof"), outage ? [{ id: "one-vm-outage", kind: "crash", node: "vm-5", atUs: 4500000, durationUs: 4500000, restartUs: 500000 }] : []);
  contract.lbAccountingProfile = "lb-accounting/1";
  contract.limits.maxRawResults = 10000;
  const compiled = compileProduct(design, contract); if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const routing: TraceEvent[] = [];
  const runtime = createProductModel2(compiled.value, undefined, event => {
    if (!["lb-selected", "health-observation"].includes(event.kind)) return;
    if (routing.length >= 6000) throw Error("Six-VM proof observation budget exceeded");
    routing.push({ at: event.atUs, kind: event.kind, id: String(event.detail.id), detail: String(event.detail.detail) });
  }), snapshots: ComputeState[][] = [];
  for (let second = 1; second <= 14; second++) {
    runtime.advanceTo(second * 1000000);
    snapshots.push(resources.slice(1).map(vm => runtime.inspect(vm.id) as ComputeState));
  }
  const evidence = runtime.evidence(), checks = routing.filter(e => e.kind === "health-observation" && JSON.parse(e.id)[2] === "vm-5");
  const removed = checks.find(e => e.detail.endsWith("eligible=false"))?.at;
  const returned = checks.find(e => removed !== undefined && e.at > removed && e.detail.endsWith("eligible=true"))?.at;
  return { design, contract, compiled: compiled.value, snapshots, evidence, routing, removed, returned };
}
