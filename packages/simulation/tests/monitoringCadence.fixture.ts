import { RESOURCE_PORTS, type Resource, type MonitoringPolicy } from "@infraforge/domain/resource";
import type { SavedProductDesign } from "../src/model2/product/contracts";
import { prepare } from "./asyncCanvas.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { withRunLength } from "../src/model2/product/runContract";
import { createProductModel2 } from "../src/model2/product/run";
import { quantities } from "./workloadFixture";

export const monitoringModes = ["vm", "db", "multiple", "cdn-dns", "target-outage", "backend-outage"] as const;
export type MonitoringMode = typeof monitoringModes[number] | "agent-outage";
export function monitoringDesign(mode: MonitoringMode = "vm", policy?: MonitoringPolicy): SavedProductDesign {
  const edge = mode === "cdn-dns";
  const types: Record<string, Resource["type"]> = edge ? { cdn: "CDN", store: "Object Storage", dns: "DNS", monitor: "Monitoring Agent" } : { vm: "Virtual Machine", ...(mode === "db" || mode === "multiple" ? { db: "Database" as const } : {}), monitor: "Monitoring Agent" };
  const targets = edge ? ["cdn", "dns"] : mode === "db" ? ["db"] : mode === "multiple" ? ["vm", "db"] : ["vm"];
  const links = [...(edge ? [["cdn", "store"], ["dns", "cdn"]] : types.db ? [["vm", "db"]] : []), ...targets.map(id => ["monitor", id])];
  const saved: SavedProductDesign = { schema: "infraforge-saved-design/1", resources: Object.entries(types).map(([id, type]) => ({ id, type, x: 0, y: 0 })), connections: links.map(([s, t], n) => ({ id: `e${n}`, sourceId: s!, targetId: t!, sourceType: types[s!]!, targetType: types[t!]!, port: RESOURCE_PORTS[types[t!]!] })), workload: { targetThroughput: 120, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 0.8, payloadSize: "light" } };
  if (policy) Object.assign(saved.resources.find(r => r.id === "monitor")!, { monitoringPolicy: policy });
  return saved;
}
export function monitoringSetup(mode: MonitoringMode = "vm", policy?: MonitoringPolicy) {
  const saved = monitoringDesign(mode, policy), adapted = prepare(saved), contract = withRunLength(adapted.contract, 65, "monitor-cadence-proof");
  if (mode.endsWith("outage")) {
    const q = quantities();
    contract.faults.push({ id: mode, kind: "Crash", target: mode === "target-outage" ? "vm" : mode === "agent-outage" ? "monitor" : "monitor/backend", at: q.q("fault.at", 15000000, "us"), duration: q.q("fault.duration", 20000000, "us"), restart: q.q("fault.restart", 1000, "us"), profile: "retain-logical-state/1" });
    contract.ledger.push(...q.ledger);
  }
  const compiled = compileProduct(saved, contract); if (!compiled.ok) throw Error(JSON.stringify(compiled));
  return { saved, contract, compiled: compiled.value, assumptions: adapted.assumptions, runtime: createProductModel2(compiled.value) };
}
