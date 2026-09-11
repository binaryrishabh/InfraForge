import { useEffect, useRef, useState } from "react";
import { RESOURCE_TYPES } from "@shared/constants/RESOURCE_TYPES.constants";
import { RESOURCE_PORTS } from "@shared/constants/RESOURCE_PORTS.constants";
import type { Resource } from "@shared/interface/Resource.interface";
import type { AutoscalingPolicy } from "@shared/interface/AutoscalingPolicy.interface";
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { hueForType, hueBorder, hueTint } from "@/theme/resourceCategoryHues";
import { ConfigNameField } from "./config/ConfigNameField";
import { AutoscalingPolicySection } from "./config/AutoscalingPolicySection";
import { InstancePickerSection } from "./config/InstancePickerSection";

interface ResourceConfigPanelProps {
  resource: Resource | undefined;
  open: boolean;
  onClose: () => void;
  onUpdateResource: (resourceId: string, patch: Partial<Resource>) => void;
}

/* Inspector drawer: slides from the right on single click, closes on outside
click, no close button. Interior is deliberately roomy — 20px gutters,
12-13px type, one concern per section, thin custom scrollbar. */
export function ResourceConfigPanel({
  resource,
  open,
  onClose,
  onUpdateResource,
}: ResourceConfigPanelProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  // Keep the last resource mounted so content survives the slide-out.
  const [displayedResource, setDisplayedResource] = useState<Resource | undefined>(resource);

  useEffect(() => {
    if (resource) setDisplayedResource(resource);
  }, [resource]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (drawerRef.current && drawerRef.current.contains(target)) return;
      // Clicking another node switches content instead of closing.
      if (target.closest("[data-resource-id]")) return;
      onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, onClose]);

  if (!displayedResource) return null;

  const hue = hueForType(displayedResource.type);
  const isLb = displayedResource.type === RESOURCE_TYPES.LoadBalancer;
  const isSkuable =
    displayedResource.type === RESOURCE_TYPES.VirtualMachine ||
    displayedResource.type === RESOURCE_TYPES.Database;

  const handleCommitPolicy = (policy: AutoscalingPolicy) =>
    onUpdateResource(displayedResource.id, { autoscaling: policy });
  const handleSkuChange = (skuId: string | undefined) =>
    onUpdateResource(displayedResource.id, { skuId });
  const handleRename = (name: string | undefined) =>
    onUpdateResource(displayedResource.id, { name });

  return (
    <div
      ref={drawerRef}
      data-config-drawer
      className={`absolute top-16 bottom-4 right-3 w-80 z-30 rounded-xl border bg-[#12161F]/95 backdrop-blur-md shadow-[0_12px_32px_rgba(0,0,0,0.45)] flex flex-col overflow-hidden transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
        open ? "translate-x-0 pointer-events-auto" : "translate-x-[calc(100%+12px)] pointer-events-none"
      }`}
      style={{ borderColor: hueBorder(hue) }}
    >
      {/* Header: identity + live name editor */}
      <div
        className="shrink-0 px-5 pt-4 pb-4"
        style={{ borderBottom: `1px solid ${hue}33` }}
      >
        <div className="flex items-center gap-3 mb-3">
          <span
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: hueTint(hue), color: hue }}
          >
            <ResourceIcon type={displayedResource.type} size={18} className="" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-[#EDF1F7] truncate">
              {displayedResource.type}
            </span>
            <span className="block text-[11px] font-mono text-[#677185] truncate">
              {displayedResource.id}
            </span>
          </span>
        </div>
        <ConfigNameField
          name={displayedResource.name}
          fallbackId={displayedResource.id}
          onRename={handleRename}
        />
      </div>
      {/* Facts strip */}
      <div className="shrink-0 px-5 py-3 flex items-center justify-between border-b border-[#1F2633]">
        <span className="text-[11px] uppercase tracking-wider text-[#677185] font-semibold">
          Default port
        </span>
        <span className="text-[13px] font-mono" style={{ color: hue }}>
          :{RESOURCE_PORTS[displayedResource.type] || 80}
        </span>
      </div>
      {/* Body — one concern per section, generous rhythm, thin scrollbar */}
      <div className="infraforge-scroll flex-1 overflow-y-auto px-5 py-5 space-y-6">
        {isLb && (
          <AutoscalingPolicySection
            resource={displayedResource}
            onCommit={handleCommitPolicy}
          />
        )}
        {isSkuable && (
          <InstancePickerSection
            resource={displayedResource}
            onSkuChange={handleSkuChange}
          />
        )}
        {!isLb && !isSkuable && (
          <p className="text-[12px] text-[#677185] leading-relaxed">
            This resource has no configurable policy or instance size. Its
            capacity comes from the connection graph and the simulation model.
          </p>
        )}
      </div>
    </div>
  );
}