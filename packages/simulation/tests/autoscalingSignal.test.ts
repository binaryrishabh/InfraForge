import { expect, test } from "bun:test";
import { RESOURCE_PORTS, type Resource, type AutoscalingSignal } from "@infraforge/domain/resource";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { startupLive } from "../src/model2/product/startupLive";
import { createProductModel2 } from "../src/model2/product/run";
import { withRunLength } from "../src/model2/product/runContract";

const signal = (over: Partial<AutoscalingSignal> = {}): AutoscalingSignal => ({ version: 1, source: "observed-core-time", monitorId: "monitor", freshForSeconds: 8, stale: "hold", ...over });
function design(opts: { signal?: AutoscalingSignal | null; watch?: boolean; monitorType?: Resource["type"] } = {}): SavedProductDesign {
  const s = opts.signal === undefined ? signal() : opts.signal;
  const types: Record<string, Resource["type"]> = { lb: "Load Balancer", app: "Virtual Machine", monitor: opts.monitorType ?? "Monitoring Agent", db: "Database" };
  const links = [["lb", "app"], ["app", "db"], ...(opts.watch === false ? [] : [["monitor", "app"]])];
  return { schema: "infraforge-saved-design/1",
    resources: Object.entries(types).map(([id, type]) => ({ id, type, x: 0, y: 0, ...(id === "app" ? { autoscaling: { enabled: true, minReplicas: 1, maxReplicas: 3, targetCpu: 60, ...(s ? { signal: s } : {}) } } : {}) })),
    connections: links.map(([a, b], n) => ({ id: `e${n}`, sourceId: a!, targetId: b!, sourceType: types[a!]!, targetType: types[b!]!, port: RESOURCE_PORTS[types[b!]!] })),
    workload: { targetThroughput: 600, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 0.8, payloadSize: "light" } };
}
const contractOf = (saved: SavedProductDesign) => { const r = contractFromDesign(saved); if ("refused" in r) throw Error(JSON.stringify(r.refused)); return r.contract; };

test("a saved observed signal captures its profile and binds the named agent's backend", () => {
  const saved = design();
  expect(currentAdapterProfiles(saved.resources)).toContain("autoscaling-observed/1");
  const contract = contractOf(saved);
  expect(contract.version).toContain("/autoscaling-observed/1");
  const bound = contract.nodes.app!.controller!.signal;
  expect(bound).toMatchObject({ kind: "observed-core-time", backend: "$monitor/backend", stale: "hold", freshFor: { value: 8000000 } });
  const compiled = compileProduct(saved, contract);
  expect(compiled.ok).toBe(true);
  if (compiled.ok) {
    expect(compiled.value.pools[0]!.profile.signal).toMatchObject({ kind: "observed-core-time", backend: "monitor/backend" });
    const monitor = compiled.value.input.resources.find(r => r.kind === "monitor");
    expect(monitor?.kind === "monitor" && compiled.value.pools[0]!.replicas.every(id => monitor.targets.includes(id))).toBe(true);
  }
});

test("a saved signal on the load balancer reaches the pool through the existing pool mapping", () => {
  const saved = design({ signal: null });
  const lbPolicy = { enabled: true, minReplicas: 1, maxReplicas: 3, targetCpu: 60, signal: signal() };
  saved.resources = saved.resources.map(r => r.id === "lb" ? { ...r, autoscaling: lbPolicy } : r.id === "app" ? { ...r, autoscaling: undefined } : r);
  expect(contractOf(saved).nodes.app!.controller!.signal.kind).toBe("observed-core-time");
});

test("omitted signal keeps the direct signal and no profile or marker", () => {
  const saved = design({ signal: null });
  expect(currentAdapterProfiles(saved.resources)).not.toContain("autoscaling-observed/1");
  const contract = contractOf(saved);
  expect(contract.version).not.toContain("autoscaling-observed");
  expect(contract.nodes.app!.controller!.signal).toEqual({ kind: "direct-core-time" });
  expect(compileProduct(saved, contract).ok).toBe(true);
});

test("designs that cannot honestly observe the pool are refused, never given direct truth", () => {
  for (const saved of [design({ watch: false }), design({ monitorType: "Cache" }), design({ signal: signal({ monitorId: "ghost" }) })]) expect(contractFromDesign(saved)).toHaveProperty("refused");
  expect(contractFromDesign(design(), { adapterProfiles: [] })).toHaveProperty("refused");
  expect(contractFromDesign(design({ signal: null }), { adapterProfiles: ["autoscaling-observed/1"] })).toHaveProperty("refused");
  const resolved = (s: unknown) => contractFromDesign(design({ signal: s as AutoscalingSignal }));
  for (const bad of [signal({ freshForSeconds: 0 }), signal({ freshForSeconds: 61 }), signal({ freshForSeconds: 1.5 }), { ...signal(), source: "direct" }, { ...signal(), stale: "scale" }, { ...signal(), extra: 1 }]) expect(resolved(bad)).toHaveProperty("refused");
});

test("the compiler refuses a controller signal that drifts from the saved selection or a missing profile marker", () => {
  const saved = design(), good = contractOf(saved);
  const variants: Array<(c: typeof good) => void> = [
    c => { c.nodes.app!.controller!.signal = { kind: "direct-core-time" }; },
    c => { const s = c.nodes.app!.controller!.signal; if (s.kind === "observed-core-time") s.backend = "$other/backend"; },
    c => { const s = c.nodes.app!.controller!.signal; if (s.kind === "observed-core-time") s.freshFor = { ...s.freshFor, value: 9000000 } as typeof s.freshFor; },
    c => { c.version = c.version.replace("/autoscaling-observed/1", ""); },
    c => { c.version += "/autoscaling-observed/1"; },
  ];
  for (const edit of variants) { const c = structuredClone(good); edit(c); expect(compileProduct(saved, c).ok).toBe(false); }
});

test("startup evidence names the selected source only for marked pools", () => {
  const live = (saved: SavedProductDesign) => {
    const contract = withRunLength(contractOf(saved), 20, "nx9-evidence"), compiled = compileProduct(saved, contract);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const runtime = createProductModel2(compiled.value); runtime.advanceTo(12000000);
    return startupLive(compiled.value, runtime, "app", id => id.split("#")[0]!.split("/")[0], 12000000)?.controllers?.[0];
  };
  expect(live(design())?.signal).toEqual({ source: "observed-core-time", backend: "monitor/backend", freshForUs: 8000000 });
  expect(live(design({ signal: null }))).not.toHaveProperty("signal");
});
