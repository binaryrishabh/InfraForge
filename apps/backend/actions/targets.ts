import { findSku } from "@infraforge/catalog";
import type { ActionRequest } from "@infraforge/contracts/actions";
import type { RunTopology } from "@infraforge/contracts/run-inputs";
import { ValidationError } from "../utils/errors";

// Model 2 itself refuses, with its reason, a replica change for a load balancer that has no pool.
export function validateActionTarget(request: ActionRequest, topology: RunTopology) {
  if (request.kind === "chaos" || request.kind === "vertical-scale") {
    const resource = topology.resources.find((r) => r.id === request.parameters.resourceId);
    if (!resource) throw new ValidationError("Action target is absent from the accepted live topology.");
    if (request.kind === "vertical-scale") {
      const sku = findSku(request.parameters.skuId);
      const current = resource.skuId ? findSku(resource.skuId) : undefined;
      if (!sku || sku.category !== resource.type || (current && current.provider !== sku.provider)) {
        throw new ValidationError("The requested SKU does not support this resource and provider.");
      }
    }
  }
  if (request.kind === "topology") {
    const { resources, connectionLines } = request.parameters;
    const ids = new Set(resources.map((r) => r.id));
    if (ids.size !== resources.length || new Set(connectionLines.map((c) => c.id)).size !== connectionLines.length ||
        connectionLines.some((c) => !ids.has(c.sourceId) || !ids.has(c.targetId))) {
      throw new ValidationError("Live topology requires unique identifiers and existing connection endpoints.");
    }
  }
}
