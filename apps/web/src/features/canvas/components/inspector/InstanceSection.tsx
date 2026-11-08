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

const GENERIC_SIZES = ["small", "medium", "large"] as const;

/* Every figure shown here comes from modeledResourceSizing, the same helper the compiler uses, so the card cannot
disagree with the simulation. A catalog SKU takes precedence over a saved generic size; an omitted size means small.
Choosing a catalog size changes only skuId (it already overrides size), so the one-change guard counts one change. */
export function InstanceSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const [provider, setProvider] = useState<ProviderId>(() => (resource.skuId && findSku(resource.skuId)?.provider) || "aws");
  return (
    <InspectorSection title="Instance size" hint="Educational model sizing: the cores shown are what the simulation uses. Generic sizes assume 1, 2 or 4 cores; catalog sizes use their advertised vCPU. A catalog size overrides a generic size; choosing a generic size removes the catalog choice. Throughput depends on workload and limits. Burst credits and baseline throttling are not simulated. Generic sizes keep the same educational monthly estimate; catalog sizes change it.">
      <Segmented label="Provider" size="sm" value={provider} onChange={setProvider} disabled={disabled}
        options={(Object.keys(PROVIDERS) as ProviderId[]).map((id) => ({ value: id, label: id === "aws" ? "AWS" : "DigitalOcean" }))} />
      <InstanceSizeChoices resource={resource} disabled={disabled} provider={provider} />
    </InspectorSection>
  );
}

export function InstanceSizeChoices({ resource, disabled, provider }: { resource: Resource; disabled: boolean; provider: ProviderId }) {
  const vm = resource.type === RESOURCE_TYPES.VirtualMachine;
  const category: SkuCategory = vm ? "Virtual Machine" : "Database";
  const sku = resource.skuId ? findSku(resource.skuId) : undefined;
  const invalidSize = resource.size !== undefined && !GENERIC_SIZES.includes(resource.size);
  const invalidSku = !!resource.skuId && (!sku || sku.category !== category);
  const selected = resource.skuId || (invalidSize ? null : `generic-${resource.size ?? "small"}`);
  const cpu = (choice: { skuId?: string; size?: Resource["size"] }) => {
    const sizing = modeledResourceSizing({ type: resource.type, skuId: choice.skuId, size: choice.size });
    return sizing ? `${sizing.cores} modeled CPU ${sizing.cores === 1 ? "core" : "cores"}` : "Unknown";
  };
  const options = [...GENERIC_SIZES.map((size) => ({ id: `generic-${size}`, label: `Generic ${size[0]!.toUpperCase()}${size.slice(1)}`,
    size: size as Resource["size"], detail: `${cpu({ size })}${vm ? "" : ` · ${SIMULATION_CONSTANTS.MAX_DB_CONNECTIONS} connections`}`, price: null as number | null })),
    ...skusFor(provider, category).map((sku) => ({ id: sku.skuId, label: sku.label, price: sku.monthlyPriceUsd,
      size: undefined as Resource["size"], detail: `${cpu({ skuId: sku.skuId })}${sku.maxConnections !== undefined ? ` · ${sku.maxConnections} connections` : ""}` }))];
  const name = `sku-${resource.id}`;
  return (
    <>
      {(invalidSize || invalidSku) && <p role="alert" className="mt-2 text-xs text-ink-2">Saved instance size is invalid. Choose a supported generic or catalog size before running.</p>}
      {resource.skuId && resource.size !== undefined && <p className="mt-2 text-xs text-ink-2">The saved catalog choice overrides the saved generic size. Choosing a generic size removes the catalog choice.</p>}
      {sku && !invalidSku && <p className="mt-2 text-xs text-ink-2">Selected catalog size: {sku.label}.</p>}
      <fieldset className="mt-3" disabled={disabled}>
        <legend className="sr-only">Instance size</legend>
        <div className="flex flex-col gap-1">
          {options.map((option) => {
            const checked = !invalidSku && selected === option.id;
            return (
              <label key={option.id || "generic"} className={cx("flex cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-2 transition-colors",
                checked ? "border-ink bg-surface" : "border-line hover:border-line-strong")}>
                <input type="radio" name={name} checked={checked} className="mt-0.5 accent-[var(--if-ink)]"
                  onChange={() => updateResource(resource.id, option.size ? { skuId: undefined, size: option.size } : { skuId: option.id })} />
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
    </>
  );
}
