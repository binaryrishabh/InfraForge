import { resolveWorkload } from "@infraforge/domain/workload";
import type { Resource } from "@infraforge/domain/resource";
import { buildModel2Contract, type ContractBuilder } from "../src/model2/product/runContract";
import { quantities } from "./workloadFixture";
export const purgeRequest = {kind: "intervention" as const, parameters: {interventionId: "cdn-purge", revision: 1, target: {resourceId: "cdn"}, parameters: {}}};
export function purgeInput(rps = 2) {
  return {resources: [{id: "cdn", type: "CDN", x: 0, y: 0}, {id: "store", type: "Object Storage", x: 0, y: 0}] as Resource[], connectionLines: [{id: "e0", sourceId: "cdn", targetId: "store", sourceType: "CDN", targetType: "Object Storage", port: 443}], workloadProfile: resolveWorkload({targetThroughput: rps * 60, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light"}), seed: "cdn-purge-proof"};
}
// Long origin work keeps multiple callers waiting across the live action boundary.
export const slowOrigin: ContractBuilder = (...args) => {
  const built = buildModel2Contract(...args); if ("refused" in built) return built;
  const origin = built.contract.nodes.store!.resources.find(r => r.config.kind === "object-store")!;
  if (origin.config.kind !== "object-store") throw Error("Expected origin");
  const {q, ledger} = quantities();
  origin.config.demands.get!.wait = q("purge.origin.wait", 2_000_000, "us");
  for (const node of Object.values(built.contract.nodes)) for (const role of node.resources) if (role.config.kind === "cdn" || role.config.kind === "object-store") role.config.timeout = q(`purge.${node.type}.timeout`, 4_000_000, "us");
  built.contract.ledger.push(...ledger); return built;
};
