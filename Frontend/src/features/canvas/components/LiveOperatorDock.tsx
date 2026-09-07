import { memo, useState } from "react";
import { LoadControlPanel } from "@/features/monitoring/components/LoadControlPanel";
import { ChaosControlPanel } from "@/features/monitoring/components/ChaosControlPanel";
import { VerticalScalePanel } from "@/features/monitoring/components/VerticalScalePanel";
import { ManualScalePanel } from "@/features/monitoring/components/ManualScalePanel";
import { LiveLogsPanel } from "@/features/monitoring/components/LiveLogsPanel";
import { SecurityIssuesPanel } from "@/features/monitoring/components/panels/SecurityIssuesPanel";
import { CostBreakdownPanel } from "@/features/monitoring/components/panels/CostBreakdownPanel";
import type { Deployment } from "@shared/interface/Deployment.interface";

type DockTab = "load" | "chaos" | "scale" | "logs" | "preflight";

interface DockTabDefinition {
  id: DockTab;
  label: string;
}

const DOCK_TABS: DockTabDefinition[] = [
  { id: "load", label: "Load" },
  { id: "chaos", label: "Chaos" },
  { id: "scale", label: "Scale" },
  { id: "logs", label: "Logs" },
  { id: "preflight", label: "Preflight" },
];

interface LiveOperatorDockProps {
  deploymentId: string;
  status: string;
  resources: Array<{ id: string; type: string; skuId?: string }>;
  deployment: Deployment | null;
}

export const LiveOperatorDock = memo(function LiveOperatorDock({
  deploymentId,
  status,
  resources,
  deployment,
}: LiveOperatorDockProps) {
  const [activeTab, setActiveTab] = useState<DockTab>("load");
  const [collapsed, setCollapsed] = useState(false);

  const renderTabContent = () => {
    if (activeTab === "load") {
      return <LoadControlPanel deploymentId={deploymentId} status={status} />;
    }

    if (activeTab === "chaos") {
      return (
        <ChaosControlPanel
          deploymentId={deploymentId}
          status={status}
          resources={resources}
        />
      );
    }

    if (activeTab === "scale") {
      return (
        <div className="grid grid-cols-2 gap-3">
          <VerticalScalePanel
            deploymentId={deploymentId}
            status={status}
            resources={resources}
          />
          <ManualScalePanel deploymentId={deploymentId} status={status} />
        </div>
      );
    }

    if (activeTab === "logs") {
      return <LiveLogsPanel />;
    }

    if (!deployment) {
      return (
        <p className="text-[10px] text-[#677185]">
          Deployment details unavailable yet.
        </p>
      );
    }
    return (
      <div className="grid grid-cols-2 gap-3">
        <SecurityIssuesPanel deployment={deployment} />
        <CostBreakdownPanel deployment={deployment} />
      </div>
    );
  };

  return (
    <div className="border-t border-[#1F2633] bg-[#12161F] shrink-0">
      <div className="h-10 px-3 flex items-center justify-between">
        <div className="flex items-center h-full">
          {DOCK_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`h-full px-3 uppercase text-[11px] font-mono tracking-wide transition-colors duration-150 ${
                  isActive
                    ? "text-[#5B8CFF] border-b-2 border-[#5B8CFF]"
                    : "text-[#677185] hover:text-[#AAB4C5] border-b-2 border-transparent"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="w-7 h-7 flex items-center justify-center text-[#677185] hover:text-[#AAB4C5] transition-colors duration-150"
          title={collapsed ? "Expand dock" : "Collapse dock"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
      </div>

      {!collapsed && (
        <div className="h-47.5 overflow-y-auto p-3">{renderTabContent()}</div>
      )}
    </div>
  );
});