import { useState } from "react";
import { toast } from "sonner";
import { scaleVertical } from "@/api/deployment.api";
import { errorMessage } from "@/api/errorMessage";
import { skusFor, findSku } from "@infraforge/catalog";
import { RESOURCE_TYPES } from "@infraforge/domain/resource";
import { PROVIDERS, type ProviderId, type SkuCategory } from "@infraforge/catalog/types";
import { PANEL_SHELL_CLASS } from "@/theme/resourceCategoryHues";

interface VerticalScalePanelProps {
  deploymentId: string;
  status: string;
  resources: Array<{ id: string; type: string; skuId?: string }>;
}

export function VerticalScalePanel(props: VerticalScalePanelProps) {
  const [requestedResourceId, setSelectedResourceId] = useState("");
  const resources = props.resources.filter(
    (r) => r.type === RESOURCE_TYPES.VirtualMachine || r.type === RESOURCE_TYPES.Database
  );
  const selectedResource = resources.find((r) => r.id === requestedResourceId) ?? resources[0];
  return (
    <VerticalScaleSelection
      key={`${props.deploymentId}:${selectedResource?.id ?? "empty"}`}
      {...props}
      resources={resources}
      selectedResource={selectedResource}
      onResourceChange={setSelectedResourceId}
    />
  );
}

interface VerticalScaleSelectionProps extends VerticalScalePanelProps {
  selectedResource: VerticalScalePanelProps["resources"][number] | undefined;
  onResourceChange: (id: string) => void;
}

function VerticalScaleSelection({ deploymentId, status, resources: skuableResources, selectedResource, onResourceChange }: VerticalScaleSelectionProps) {
  const selectedResourceId = selectedResource?.id ?? "";
  const [selectedSkuId, setSelectedSkuId] = useState(selectedResource?.skuId ?? "");
  const [provider, setProvider] = useState<ProviderId>(() =>
    selectedResource?.skuId ? findSku(selectedResource.skuId)?.provider ?? "aws" : "aws",
  );
  const [loading, setLoading] = useState(false);
  const isLive = status === "live";

  const handleProviderChange = (next: ProviderId) => {
    setProvider(next);
    const resSkuId = selectedResource?.skuId;
    const resSkuProvider = resSkuId ? findSku(resSkuId)?.provider : undefined;
    setSelectedSkuId(resSkuProvider === next ? resSkuId! : "");
  };

  const category: SkuCategory =
    selectedResource?.type === RESOURCE_TYPES.Database ? "Database" : "Virtual Machine";

  const skus = skusFor(provider, category);
  const currentSkuId = selectedResource?.skuId ?? "";
  const canScale =
    isLive && !!selectedResource && !!selectedSkuId && selectedSkuId !== currentSkuId;

  const handleScale = async () => {
    if (!selectedResource || !selectedSkuId) return;
    setLoading(true);
    try {
      const message = await scaleVertical(deploymentId, selectedResourceId, selectedSkuId);
      toast.success(message);
    } catch (err) {
      toast.error(errorMessage(err, "Failed to scale resource"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={PANEL_SHELL_CLASS}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] uppercase tracking-wider text-[#677185] font-semibold">Vertical Scale</h3>
      </div>
      {skuableResources.length === 0 ? (
        <p className="text-[9px] text-[#677185]">No Virtual Machines or Databases to scale.</p>
      ) : (
        <div className="space-y-2">
          <select
            value={selectedResourceId}
            onChange={(e) => onResourceChange(e.target.value)}
            disabled={!isLive || loading}
            className="w-full h-8 rounded-lg bg-[#0B0E14] border border-[#273042] text-[11px] text-[#EDF1F7] px-2.5 outline-none focus:border-[#5B8CFF] transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {skuableResources.map((resource) => (
              <option key={resource.id} value={resource.id}>{resource.id}</option>
            ))}
          </select>
          <div className="flex rounded-lg border border-[#273042] overflow-hidden">
            {(Object.keys(PROVIDERS) as ProviderId[]).map((providerId) => (
              <button
                key={providerId}
                type="button"
                onClick={() => handleProviderChange(providerId)}
                disabled={!isLive || loading}
                className={`flex-1 py-1.5 text-[11px] transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
                  provider === providerId
                    ? "bg-[#5B8CFF] text-[#081018] font-medium"
                    : "bg-[#0B0E14] text-[#AAB4C5] hover:text-[#EDF1F7]"
                }`}
              >
                {providerId === "aws" ? "AWS" : "DigitalOcean"}
              </button>
            ))}
          </div>
          <select
            value={selectedSkuId}
            onChange={(e) => setSelectedSkuId(e.target.value)}
            disabled={!isLive || loading}
            className="w-full h-8 rounded-lg bg-[#0B0E14] border border-[#273042] text-[11px] text-[#EDF1F7] px-2.5 outline-none focus:border-[#5B8CFF] transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <option value="" disabled>Select a SKU…</option>
            {skus.map((sku) => (
              <option key={sku.skuId} value={sku.skuId}>
                {sku.label} · ${sku.monthlyPriceUsd}/mo
              </option>
            ))}
          </select>
          <button
            onClick={handleScale}
            disabled={!canScale || loading}
            className="w-full h-8 rounded-lg bg-[#5B8CFF] text-[11px] font-medium text-[#081018] hover:bg-[#7AA2FF] active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            {loading && (
              <span className="w-3 h-3 border-2 border-[#081018]/30 border-t-[#081018] rounded-full animate-spin" />
            )}
            Scale
          </button>
        </div>
      )}
      <p className="text-[9px] text-[#677185] mt-1.5">Resource restarts during the swap.</p>
      {!isLive && (
        <p className="text-[9px] text-[#677185] mt-1.5">Vertical scaling is available while the environment is live.</p>
      )}
    </div>
  );
}
