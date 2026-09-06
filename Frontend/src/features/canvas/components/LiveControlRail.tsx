import { memo } from "react";
import { LoadControlPanel } from "@/features/monitoring/components/LoadControlPanel";
import { ChaosControlPanel } from "@/features/monitoring/components/ChaosControlPanel";
import { VerticalScalePanel } from "@/features/monitoring/components/VerticalScalePanel";
import { ManualScalePanel } from "@/features/monitoring/components/ManualScalePanel";
import { LiveLogsPanel } from "@/features/monitoring/components/LiveLogsPanel";

interface LiveControlRailProps {
  deploymentId: string;
  status: string;
  resources: Array<{ id: string; type: string; skuId?: string }>;
}

export const LiveControlRail = memo(function LiveControlRail({
  deploymentId,
  status,
  resources,
}: LiveControlRailProps) {
  return (
    <div className="w-80 border-l border-gray-800 overflow-y-auto p-4 space-y-4 bg-[#0f1117]">
      <LoadControlPanel deploymentId={deploymentId} status={status} />
      <ChaosControlPanel deploymentId={deploymentId} status={status} resources={resources} />
      <VerticalScalePanel deploymentId={deploymentId} status={status} resources={resources} />
      <ManualScalePanel deploymentId={deploymentId} status={status} />
      <LiveLogsPanel />
    </div>
  );
});