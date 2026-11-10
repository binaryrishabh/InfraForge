import { gatewayQuotaError, type Resource } from "@infraforge/domain/resource";
import type { ProductContract } from "./contracts";
import type { SystemsInput } from "../systems/contracts";
export const GATEWAY_QUOTA_PROFILE = "gateway-quota/1" as const;
export const gatewayQuotaChanges = (resources: readonly Resource[]) => resources.some(r => r.gatewayQuota !== undefined);
export function validateGatewayQuotaProfile(resources: readonly Resource[], contract: ProductContract) {
  if (gatewayQuotaChanges(resources) !== /(?:^|\/)gateway-quota\/1(?:\/|$)/.test(contract.version)) throw Error("Gateway quota requires captured gateway-quota/1 and matching saved intent");
  for (const r of resources) { const error = gatewayQuotaError(r.type, r.gatewayQuota, r.apiGateway); if (error) throw Error(error); }
}
export function validateGatewayQuotaBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources) {
    const runtime = input.resources.find(s => s.id === r.id);
    if (r.gatewayQuota && (runtime?.kind !== "api-gateway" || runtime.quota?.profile !== GATEWAY_QUOTA_PROFILE || runtime.quota.scope !== r.gatewayQuota.scope)) throw Error("Gateway quota must match owned saved intent");
    if (runtime?.kind === "api-gateway" && !r.gatewayQuota && runtime.quota !== undefined) throw Error("Gateway quota needs saved intent");
  }
}
