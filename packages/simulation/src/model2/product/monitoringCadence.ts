import type { Resource } from "@infraforge/domain/resource";
import { requireKnown, type Quantity } from "../../reality/quantity";
import type { ProductContract } from "./contracts";
import type { SystemsInput } from "../systems/contracts";

export const MONITOR_CADENCE_PROFILE = "monitor-cadence/1" as const;
export const changedMonitoringCadence = (r: Resource) => r.monitoringPolicy?.collectionIntervalSeconds !== undefined || r.monitoringPolicy?.exportIntervalSeconds !== undefined;
export const monitoringCadenceChanges = (resources: readonly Resource[]) => resources.some(changedMonitoringCadence);
export function monitoringCadence(r: Resource, q: (id: string, value: number, unit: "us", sentence?: string, authored?: boolean) => Quantity<"us">) {
  const collection = r.monitoringPolicy?.collectionIntervalSeconds, exp = r.monitoringPolicy?.exportIntervalSeconds;
  return {
    interval: collection === undefined ? q(`${r.id}.interval`, 10000000, "us") : q(`${r.id}.interval`, collection * 1000000, "us", "Saved interval between target observation requests.", true),
    exportInterval: exp === undefined ? q(`${r.id}.exportInterval`, 10000000, "us") : q(`${r.id}.exportInterval`, exp * 1000000, "us", "Saved interval between buffered observation export opportunities.", true),
  };
}
export function validateMonitoringCadenceProfile(resources: readonly Resource[], contract: ProductContract) {
  const count = (version: string) => {
    const profiles = version.match(/\/monitor-cadence\/[^/]+/g) ?? [];
    if (profiles.some(p => p !== `/${MONITOR_CADENCE_PROFILE}`)) throw Error("Unsupported monitoring cadence profile");
    return profiles.length;
  };
  if (count(contract.version) !== Number(monitoringCadenceChanges(resources))) throw Error("Monitoring cadence requires its explicit monitor-cadence/1 contract version and matching saved intent");
  for (const r of resources) if (count(contract.nodes[r.id]?.profileVersion ?? "") !== Number(changedMonitoringCadence(r))) throw Error("Monitoring cadence requires its owned profile and matching saved intent");
}
export function validateMonitoringCadenceBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(changedMonitoringCadence)) {
    const p = r.monitoringPolicy, monitor = input.resources.find(c => c.id === r.id);
    if (!p || r.type !== "Monitoring Agent" || monitor?.kind !== "monitor") throw Error("Cadence requires its owned Monitoring Agent engine");
    if (requireKnown(monitor.interval, "us") !== (p.collectionIntervalSeconds ?? 10) * 1000000 || requireKnown(monitor.exportInterval, "us") !== (p.exportIntervalSeconds ?? 10) * 1000000 || requireKnown(monitor.freshFor, "us") !== 30000000) throw Error("Monitoring cadence and historical freshness must match saved intent");
  }
}
