import { useState } from "react";
import { findSku, skusFor } from "@infraforge/catalog";
import { PROVIDERS, type ProviderId, type SkuCategory } from "@infraforge/catalog/types";
import { modeledResourceSizing } from "@infraforge/simulation/capacity";
import { SIMULATION_CONSTANTS } from "@infraforge/simulation/tuning";
import { RESOURCE_TYPES, type Resource } from "@infraforge/domain/resource";
import { Segmented } from "@/ui/Segmented";
import { cx } from "@/ui/cx";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

/* Generic retains the saved small/medium/large size; an omitted size uses small. */
export function InstanceSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const vm = resource.type === RESOURCE_TYPES.VirtualMachine;
  const [provider, setProvider] = useState<ProviderId>(() => (resource.skuId && findSku(resource.skuId)?.provider) || "aws");
  const category: SkuCategory = vm ? "Virtual Machine" : "Database";
  const cpu = (skuId?: string) => {
    const sizing = modeledResourceSizing({ ...resource, skuId });
    return sizing ? `${sizing.cores} modeled CPU ${sizing.cores === 1 ? "core" : "cores"}` : "Unknown";
  };
  const options = [{ id: "", label: "Generic", detail: `${cpu()}${vm ? "" : ` · ${SIMULATION_CONSTANTS.MAX_DB_CONNECTIONS} connections`}`, price: null as number | null },
    ...skusFor(provider, category).map((sku) => ({ id: sku.skuId, label: sku.label, price: sku.monthlyPriceUsd,
      detail: `${cpu(sku.skuId)}${sku.maxConnections !== undefined ? ` · ${sku.maxConnections} connections` : ""}` }))];
  const name = `sku-${resource.id}`;
  return (
    <InspectorSection title="Instance size" hint="Educational model sizing. Throughput depends on workload and limits. Burst credits and baseline throttling are not simulated.">
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
