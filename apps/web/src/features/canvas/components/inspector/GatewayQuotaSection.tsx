import type { Resource } from "@infraforge/domain/resource";
import { updateResource } from "../../actions";
export function GatewayQuotaSection({resource, disabled}: {resource: Resource; disabled: boolean}) {
  return <div>
    <label>Quota scope <select aria-label="Quota scope" disabled={disabled} value={resource.gatewayQuota?.scope ?? "legacy"} onChange={e => updateResource(resource.id, {gatewayQuota: e.target.value === "legacy" ? undefined : {version: 1, scope: e.target.value as "shared" | "per-route"}})}><option value="legacy">Independent route budgets</option><option value="shared">Shared across routes</option><option value="per-route">Separate for each route</option></select></label>
    {resource.gatewayQuota && <p>Quota scope requires two or more explicit routes with equal burst and refill budgets. Each scope uses those saved budgets; shared scope owns one bucket.</p>}
  </div>;
}
