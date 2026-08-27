import { useEffect, useState } from "react";
import { RESOURCE_TYPES } from "@shared/constants/RESOURCE_TYPES.constants";
import { RESOURCE_PORTS } from "@shared/constants/RESOURCE_PORTS.constants";
import {
  PROVIDERS,
  type ProviderId,
  type Sku,
  type SkuCategory,
} from "@shared/catalog/catalog.types";
import { skusFor, findSku } from "@shared/catalog/index";
import { SIMULATION_CONSTANTS } from "@shared/constants/SIMULATION_CONSTANTS.constants";
import type { Resource } from "@shared/interface/Resource.interface";
import { ResourceIcon } from "@/components/common/ResourceIcon";

interface ResourceConfigPanelProps {
  resource: Resource | undefined;
  onClose: () => void;
  onUpdateResource: (resourceId: string, patch: Partial<Resource>) => void;
}

export function ResourceConfigPanel({
  resource,
  onClose,
  onUpdateResource,
}: ResourceConfigPanelProps) {
  const [provider, setProvider] = useState<ProviderId>("aws");

  // When the selected resource changes, open the provider that owns its current SKU
  useEffect(() => {
    if (resource?.skuId) {
      const current = findSku(resource.skuId);
      if (current) setProvider(current.provider);
    }
  }, [resource?.id]);

  if (!resource) {
    return null;
  }

  const isSkuable =
    resource.type === RESOURCE_TYPES.VirtualMachine ||
    resource.type === RESOURCE_TYPES.Database;
  const skus: Sku[] = isSkuable
    ? skusFor(provider, resource.type as SkuCategory)
    : [];
  const isVm = resource.type === RESOURCE_TYPES.VirtualMachine;

  return (
    <div className="config-panel-container fixed right-0 top-12 bottom-0 w-64 bg-gray-950 border-l border-gray-800 p-4 z-30 overflow-y-auto hover:opacity-100 opacity-50">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">Resource Config</h3>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-red-600 text-xs cursor-pointer"
        >
          X
        </button>
      </div>
      <div className="space-y-3">
        <div>
          <ResourceIcon type={resource.type} size={24} />
          <h3 className="text-sm font-semibold text-white mt-3">
            {resource.type}
          </h3>
          <p className="text-[10px] font-mono text-[#677185] mt-0.5">
            {resource.id}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 uppercase">Position</p>
          <p className="text-sm text-gray-300">
            x: {resource.x}, y: {resource.y}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 uppercase">Default Port</p>
          <p className="text-sm text-blue-400">
            {RESOURCE_PORTS[resource.type] || 80}
          </p>
        </div>

        {isSkuable && (
          <div>
            <p className="text-[10px] text-gray-500 uppercase mb-1.5">
              Instance — {isVm ? "compute" : "database"}
            </p>
            {/* Provider toggle */}
            <div className="flex rounded-lg border border-[#273042] overflow-hidden mb-2">
              {(Object.keys(PROVIDERS) as ProviderId[]).map((providerId) => (
                <button
                  key={providerId}
                  type="button"
                  onClick={() => setProvider(providerId)}
                  className={`flex-1 py-1.5 text-[11px] transition-colors duration-150 ${provider === providerId ? "bg-[#5B8CFF] text-[#081018] font-medium" : "bg-[#0B0E14] text-[#AAB4C5] hover:text-[#EDF1F7]"}`}
                >
                  {providerId === "aws" ? "AWS" : "DigitalOcean"}
                </button>
              ))}
            </div>
            {/* SKU list */}
            <div className="space-y-1.5">
              {skus.map((sku) => {
                const selected = resource.skuId === sku.skuId;
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
                    onClick={() =>
                      onUpdateResource(resource.id, { skuId: sku.skuId })
                    }
                    className={`w-full text-left rounded-lg border px-2.5 py-2 transition-colors duration-150 ${selected ? "border-[#5B8CFF] bg-[rgba(91,140,255,0.10)]" : "border-[#273042] bg-[#0B0E14] hover:border-[#35415A]"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-[11px] font-medium truncate ${selected ? "text-[#5B8CFF]" : "text-[#EDF1F7]"}`}
                      >
                        {sku.label}
                      </span>
                      <span className="text-[10px] font-mono text-green-400 shrink-0">
                        ${sku.monthlyPriceUsd}/mo
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[9px] font-mono text-[#677185]">
                        {sku.family}
                      </span>
                      <span className="text-[9px] font-mono text-[#AAB4C5]">
                        {capacity} {isVm ? "rps" : "qps"}
                      </span>
                    </div>
                    {sku.maxConnections !== undefined && (
                      <p className="text-[9px] font-mono text-[#677185] mt-0.5">
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
                onClick={() =>
                  onUpdateResource(resource.id, { skuId: undefined })
                }
                className="w-full mt-2 py-1.5 rounded-lg border border-[#273042] text-[10px] text-[#677185] hover:text-[#AAB4C5] hover:border-[#35415A] transition-colors duration-150"
              >
                Clear SKU — use generic capacity
              </button>
            )}
            <p className="text-[9px] text-[#677185] mt-2">
              Changing the instance changes this deployment's real capacity and
              cost. Save or Update the layout, then deploy.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}