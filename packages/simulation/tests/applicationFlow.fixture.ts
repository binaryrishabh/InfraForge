import { networkFixture } from "./networkFixture";
import type { ComputeResource, ComputeProfile } from "../src/model2/compute/contracts";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { quantities } from "./workloadFixture";

export function legacyVmCall() {
  const d = networkFixture({ count: 1 }), app = d.resources[0] as ComputeResource;
  app.downstream = "service";
  d.resources.push({ ...structuredClone(app), id: "service", downstream: undefined }); d.endpoints.service = { alive: true, ready: true };
  const p = d.paths[0]!, l = d.links[0]!;
  d.links.push({ ...l, id: "req", from: "app", to: "service" }, { ...l, id: "res", from: "service", to: "app" });
  d.paths.push({ ...structuredClone(p), id: "app-service", source: "app", target: "service", request: ["req"], response: ["res"] });
  return d;
}
export function fanout(wait: "all" | number = "all", options: Parameters<typeof networkFixture>[0] = {}) {
  const d = networkFixture({ count: 1, cpu: 100, bytes: 0, responseBytes: 0, propagation: 0, establish: 0, cancellation: "cooperative", ...options });
  const app = d.resources[0] as ComputeResource, q = quantities();
  app.applicationFlow = { schema: "application-flow/1", operations: { light: { steps: [
    { id: "cpu", kind: "compute" }, { id: "dependencies", kind: "parallel", wait, branches: ["inventory", "pricing", "tax"].map(id => ({ id, kind: "call", target: id })) },
  ] } } };
  for (const [index, id] of ["inventory", "pricing", "tax"].entries()) {
    const service: ComputeResource = { ...structuredClone(app), id, applicationFlow: undefined };
    for (const op of d.operations) {
      const p = d.profiles.find(p => p.id === app.profiles[op.id]) as ComputeProfile;
      const profile = { ...structuredClone(p), id: `${id}.${op.id}`, cpu: q.q(`${id}.${op.id}.cpu`, (index + 1) * 1000, "cpu-us") };
      d.profiles.push(profile); service.profiles[op.id] = profile.id;
    }
    d.resources.push(service); d.endpoints[id] = { alive: true, ready: true };
    const path = d.paths[0]!, link = d.links[0]!;
    d.links.push({ ...link, id: `${id}-req`, from: "app", to: id }, { ...link, id: `${id}-res`, from: id, to: "app" });
    d.paths.push({ ...structuredClone(path), id: `app-${id}`, source: "app", target: id, request: [`${id}-req`], response: [`${id}-res`] });
  }
  d.ledger.push(...q.ledger); return d;
}
export function canvasFlow(): SavedProductDesign {
  const ids = ["app", "inventory", "pricing", "tax"];
  return { schema: "infraforge-saved-design/1", resources: ids.map(id => ({ id, type: "Virtual Machine", x: 0, y: 0, ...(id === "app" ? { applicationFlow: {
    schema: "application-flow/1" as const, operations: { read: { steps: [{ id: "cpu", kind: "compute" as const }, { id: "services", kind: "parallel" as const, wait: "all" as const,
      branches: ids.slice(1).map(id => ({ id, kind: "call" as const, edge: `app-${id}` })) }] } },
  } } : {}) })), connections: ids.slice(1).map(id => ({ id: `app-${id}`, sourceId: "app", targetId: id, sourceType: "Virtual Machine", targetType: "Virtual Machine", port: 80 })),
    workload: { targetThroughput: 60, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light" } };
}
