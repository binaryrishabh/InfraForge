import { memo, useState } from "react";
import { LoadControlPanel } from "@/features/monitoring/components/LoadControlPanel";
import { ChaosControlPanel } from "@/features/monitoring/components/ChaosControlPanel";
import { VerticalScalePanel } from "@/features/monitoring/components/VerticalScalePanel";
import { ManualScalePanel } from "@/features/monitoring/components/ManualScalePanel";
import { LiveLogsPanel } from "@/features/monitoring/components/LiveLogsPanel";
import { SecurityIssuesPanel } from "@/features/monitoring/components/panels/SecurityIssuesPanel";
import { CostBreakdownPanel } from "@/features/monitoring/components/panels/CostBreakdownPanel";
import { useCanvasStore } from "../store/canvasStore";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
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

/* Floating bottom-center operator panel — same blurred floating grammar as
every other chrome surface. The header carries the live readout (nodes ·
links · simulated clock) so the status pill is design-only now. */
export const LiveOperatorDock = memo(function LiveOperatorDock({
  deploymentId,
  status,
  resources,
  deployment,
}: LiveOperatorDockProps) {
  const [activeTab, setActiveTab] = useState<DockTab>("load");
  const [collapsed, setCollapsed] = useState(false);
  // Primitive-only subscriptions for the header live readout.
  const nodeCount = useCanvasStore((s) => s.resources.length);
  const linkCount = useCanvasStore((s) => s.connectionLines.length);
  const simulatedSeconds = useSimulationStore((s) => s.simulatedSeconds);

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
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 w-[min(720px,calc(100vw-2rem))]">
      <div className="rounded-xl border border-[#273042] bg-[#12161F]/95 backdrop-blur-md shadow-[0_12px_32px_rgba(0,0,0,0.45)] overflow-hidden">
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
          <div className="flex items-center gap-2">
            {/* Live readout — status-pill grammar, primitive subscriptions */}
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#677185] whitespace-nowrap">
              <span className="text-[#AAB4C5] tabular-nums">{nodeCount}</span> nodes ·{" "}
              <span className="text-[#AAB4C5] tabular-nums">{linkCount}</span> links · t+
              <span className="text-[#AAB4C5] tabular-nums">{simulatedSeconds}</span>s
            </span>
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              className="w-7 h-7 flex items-center justify-center text-[#677185] hover:text-[#AAB4C5] transition-colors duration-150"
              title={collapsed ? "Expand dock" : "Collapse dock"}
            >
              {collapsed ? "▸" : "▾"}
            </button>
          </div>
        </div>
        {!collapsed && (
          <div className="max-h-48 overflow-y-auto p-3 infraforge-scroll">
            {renderTabContent()}
          </div>
        )}
      </div>
    </div>
  );
});