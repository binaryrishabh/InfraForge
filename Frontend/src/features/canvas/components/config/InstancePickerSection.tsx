import { useEffect, useState } from "react";
import {
  PROVIDERS,
  type ProviderId,
  type Sku,
  type SkuCategory,
} from "@shared/catalog/catalog.types";
import { skusFor, findSku } from "@shared/catalog/index";
import { SIMULATION_CONSTANTS } from "@shared/constants/SIMULATION_CONSTANTS.constants";
import { RESOURCE_TYPES } from "@shared/constants/RESOURCE_TYPES.constants";
import type { Resource } from "@shared/interface/Resource.interface";

interface InstancePickerSectionProps {
  resource: Resource;
  onSkuChange: (skuId: string | undefined) => void;
}

export function InstancePickerSection({ resource, onSkuChange }: InstancePickerSectionProps) {
  const [provider, setProvider] = useState<ProviderId>("aws");
  const [selectedSkuId, setSelectedSkuId] = useState<string>("");

  useEffect(() => {
    setSelectedSkuId(resource.skuId ?? "");
    setProvider(resource.skuId ? findSku(resource.skuId)?.provider ?? "aws" : "aws");
  }, [resource.id]);

  const isVm = resource.type === RESOURCE_TYPES.VirtualMachine;
  const category: SkuCategory = isVm ? "Virtual Machine" : "Database";
  const skus: Sku[] = skusFor(provider, category);

  const handleProviderChange = (next: ProviderId) => {
    setProvider(next);
    const currentProvider = resource.skuId
      ? findSku(resource.skuId)?.provider
      : undefined;
    setSelectedSkuId(currentProvider === next ? resource.skuId ?? "" : "");
  };

  return (
    <section>
      <h4 className="text-[12px] uppercase tracking-wider text-[#677185] font-semibold mb-3">
        Instance — {isVm ? "compute" : "database"}
      </h4>
      <div className="space-y-3">
        <div className="flex rounded-lg border border-[#273042] overflow-hidden">
          {(Object.keys(PROVIDERS) as ProviderId[]).map((providerId) => (
            <button
              key={providerId}
              type="button"
              onClick={() => handleProviderChange(providerId)}
              className={`flex-1 h-9 text-[12px] transition-colors duration-150 ${
                provider === providerId
                  ? "bg-[#5B8CFF] text-[#081018] font-medium"
                  : "bg-[#0B0E14] text-[#AAB4C5] hover:text-[#EDF1F7]"
              }`}
            >
              {providerId === "aws" ? "AWS" : "DigitalOcean"}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {skus.map((sku) => {
            const selected = selectedSkuId === sku.skuId;
            const capacity = Math.round(
              sku.vCpu *
                sku.baselineFactor *
                (isVm
                  ? SIMULATION_CONSTANTS.RPS_PER_VCPU
                  : SIMULATION_CONSTANTS.QPS_PER_VCPU),
            );
            return (
              <button
                key={sku.skuId}
                type="button"
                onClick={() => onSkuChange(sku.skuId)}
                className="w-full text-left rounded-lg border px-3 py-2.5 transition-colors duration-150"
                style={{
                  borderColor: selected ? "#5B8CFF" : "#273042",
                  background: selected ? "rgba(91,140,255,0.10)" : "#0B0E14",
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`text-[12px] font-medium truncate ${
                      selected ? "text-[#5B8CFF]" : "text-[#EDF1F7]"
                    }`}
                  >
                    {sku.label}
                  </span>
                  <span className="text-[11px] font-mono text-green-400 shrink-0">
                    ${sku.monthlyPriceUsd}/mo
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] font-mono text-[#677185]">{sku.family}</span>
                  <span className="text-[10px] font-mono text-[#AAB4C5]">
                    {capacity} {isVm ? "rps" : "qps"}
                  </span>
                </div>
                {sku.maxConnections !== undefined && (
                  <p className="text-[10px] font-mono text-[#677185] mt-1">
                    max {sku.maxConnections} connections
                  </p>
                )}
              </button>
            );
          })}
        </div>

        {resource.skuId && (
          <button
            type="button"
            onClick={() => onSkuChange(undefined)}
            className="w-full h-8 rounded-lg border border-[#273042] text-[11px] text-[#677185] hover:text-[#AAB4C5] hover:border-[#35415A] transition-colors duration-150"
          >
            Clear SKU — use generic capacity
          </button>
        )}

        <p className="text-[11px] text-[#677185] leading-relaxed">
          Changing the instance changes real capacity and cost. The resource
          restarts during a live swap.
        </p>
      </div>
    </section>
  );
}