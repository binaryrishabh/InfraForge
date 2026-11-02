import { resolveWorkload } from "@infraforge/domain/workload";
import { cdnDesign } from "./cdnTtl.fixture";
import { buildModel2Contract, type ContractBuilder } from "../src/model2/product/runContract";
import { quantities } from "./workloadFixture";
export const purgeRequest = {kind: "intervention" as const, parameters: {interventionId: "cdn-purge", revision: 1, target: {resourceId: "cdn"}, parameters: {}}};
export function purgeInput(rps = 2) {
  const design = cdnDesign();
  return {resources: design.resources, connectionLines: design.connections, workloadProfile: resolveWorkload({...design.workload, targetThroughput: rps * 60}), seed: "cdn-purge-proof"};
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
