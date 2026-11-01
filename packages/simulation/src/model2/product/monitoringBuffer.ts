import type { Resource } from "@infraforge/domain/resource";
import { requireKnown, type Quantity } from "../../reality/quantity";
import type { ProductContract } from "./contracts";
import type { SystemsInput } from "../systems/contracts";

export const MONITOR_BUFFER_PROFILE = "monitor-buffer/1" as const;
export const changedMonitoringBuffer = (r: Resource) => r.monitoringPolicy?.version === 2;
export const monitoringBufferChanges = (resources: readonly Resource[]) => resources.some(changedMonitoringBuffer);
export function monitoringBuffer(r: Resource, q: (id: string, value: number, unit: "count", sentence?: string, authored?: boolean) => Quantity<"count">) {
  const p = r.monitoringPolicy, explicit = p?.version === 2;
  return {
    bufferSamples: q(`${r.id}.bufferSamples`, explicit ? p.bufferSamples : 1000, "count", explicit ? "Saved maximum observations owned by the local buffer and exports in flight." : undefined, explicit),
    batchSamples: q(`${r.id}.batch`, explicit ? p.batchSamples : 100, "count", explicit ? "Saved maximum observations sent in one export batch." : undefined, explicit),
    attempts: q(`${r.id}.attempts`, explicit ? p.exportAttempts : 2, "count", explicit ? "Saved export attempt limit; unconfirmed exports may already have reached the backend." : undefined, explicit),
  };
}
export function validateMonitoringBufferProfile(resources: readonly Resource[], contract: ProductContract) {
  const count = (version: string) => {
    const profiles = version.match(/\/monitor-buffer\/[^/]+/g) ?? [];
    if (profiles.some(p => p !== `/${MONITOR_BUFFER_PROFILE}`)) throw Error("Unsupported monitoring buffer profile");
    return profiles.length;
  };
  if (count(contract.version) !== Number(monitoringBufferChanges(resources))) throw Error("Monitoring buffer requires its explicit monitor-buffer/1 contract version and matching saved intent");
  for (const r of resources) if (count(contract.nodes[r.id]?.profileVersion ?? "") !== Number(changedMonitoringBuffer(r))) throw Error("Monitoring buffer requires its owned profile and matching saved intent");
}
export function validateMonitoringBufferBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(changedMonitoringBuffer)) {
    const p = r.monitoringPolicy, m = input.resources.find(c => c.id === r.id);
    if (p?.version !== 2 || r.type !== "Monitoring Agent" || m?.kind !== "monitor") throw Error("Buffer policy requires its owned Monitoring Agent engine");
    if (requireKnown(m.bufferSamples, "count") !== p.bufferSamples || requireKnown(m.batchSamples, "count") !== p.batchSamples || requireKnown(m.attempts, "count") !== p.exportAttempts || requireKnown(m.sampleBytes, "bytes") !== 128 || requireKnown(m.bufferBytes, "bytes") !== 1048576 || requireKnown(m.interval, "us") !== (p.collectionIntervalSeconds ?? 10) * 1000000 || requireKnown(m.exportInterval, "us") !== (p.exportIntervalSeconds ?? 10) * 1000000 || requireKnown(m.freshFor, "us") !== 30000000) throw Error("Monitoring buffer policy and historical byte, cadence and freshness settings must match saved intent");
  }
}
