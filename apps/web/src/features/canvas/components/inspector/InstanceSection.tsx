import { useState } from "react";
import { findSku, skusFor } from "@infraforge/catalog";
import { PROVIDERS, type ProviderId, type SkuCategory } from "@infraforge/catalog/types";
import { CAPACITY } from "@infraforge/simulation/capacity";
import { SIMULATION_CONSTANTS } from "@infraforge/simulation/tuning";
import { RESOURCE_TYPES, type Resource } from "@infraforge/domain/resource";
import { Segmented } from "@/ui/Segmented";
import { cx } from "@/ui/cx";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

/* Catalog sizes change capacity and the monthly estimate. "Generic" uses the
model's default capacity for the type. */
export function InstanceSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const vm = resource.type === RESOURCE_TYPES.VirtualMachine;
  const [provider, setProvider] = useState<ProviderId>(() => (resource.skuId && findSku(resource.skuId)?.provider) || "aws");
  const category: SkuCategory = vm ? "Virtual Machine" : "Database";
  const perCpu = vm ? SIMULATION_CONSTANTS.RPS_PER_VCPU : SIMULATION_CONSTANTS.QPS_PER_VCPU;
  const unit = vm ? "rps" : "qps";
  const options = [{ id: "", label: "Generic", detail: `${CAPACITY[resource.type].rps} ${unit}${vm ? "" : ` · ${SIMULATION_CONSTANTS.MAX_DB_CONNECTIONS} connections`}`, price: null as number | null },
    ...skusFor(provider, category).map((sku) => ({ id: sku.skuId, label: sku.label, price: sku.monthlyPriceUsd,
      detail: `${Math.round(sku.vCpu * sku.baselineFactor * perCpu)} ${unit}${sku.maxConnections !== undefined ? ` · ${sku.maxConnections} connections` : ""}` }))];
  const name = `sku-${resource.id}`;
  return (
    <InspectorSection title="Instance size" hint="Changes capacity and the monthly estimate.">
      <Segmented label="Provider" size="sm" value={provider} onChange={setProvider} disabled={disabled}
        options={(Object.keys(PROVIDERS) as ProviderId[]).map((id) => ({ value: id, label: id === "aws" ? "AWS" : "DigitalOcean" }))} />
      <fieldset className="mt-3" disabled={disabled}>
        <legend className="sr-only">Instance size</legend>
        <div className="flex flex-col gap-1">
          {options.map((option) => {
            const checked = (resource.skuId ?? "") === option.id;
            return (
              <label key={option.id || "generic"} className={cx("flex cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-2 transition-colors",
                checked ? "border-ink bg-surface" : "border-line hover:border-line-strong")}>
                <input type="radio" name={name} checked={checked} className="mt-0.5 accent-[var(--if-ink)]"
                  onChange={() => updateResource(resource.id, { skuId: option.id || undefined })} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{option.label}</span>
                  <span className="if-num block text-[11px] text-ink-3">{option.detail}</span>
                </span>
                {option.price !== null && <span className="if-num shrink-0 text-xs text-ink-2">${option.price.toFixed(2)}/mo</span>}
              </label>
            );
          })}
        </div>
      </fieldset>
    </InspectorSection>
  );
}
