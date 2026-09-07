import { memo } from "react";
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { useSimulationStore } from "../store/simulationStore";
import { ResourceHealth } from "@shared/enum/ResourceHealth.enum";
import { MonitoringCardSparkline } from "./MonitoringCardSparkline";
import { CHAOS_LABELS } from "@shared/constants/CHAOS_LABELS.constants";
import { hueForType, hueBorder, hueTint, hueTile, CATEGORY_OF_RESOURCE_TYPE } from "@/theme/resourceCategoryHues";
import type { Resource } from "@shared/interface/Resource.interface";

export const NODE_CARD_WIDTH = 220;
export const NODE_CARD_HEIGHT = 140;

interface MonitoringDashboardCardProps {
  resource: Resource;
  onNodePointerDown?: (
    nodeId: string,
    clientX: number,
    clientY: number,
    pointerId: number,
  ) => void;
  scale?: number;
}

const healthChipStyles: Record<string, { text: string; border: string }> = {
  [ResourceHealth.HEALTHY]: { text: "text-emerald-400", border: "border-emerald-400/40" },
  [ResourceHealth.DEGRADED]: { text: "text-amber-400", border: "border-amber-400/40" },
  [ResourceHealth.SATURATED]: { text: "text-red-400", border: "border-red-400/40" },
  [ResourceHealth.FAILED]: { text: "text-red-500", border: "border-red-500/40" },
};

function getBarColor(pct: number): string {
  if (pct >= 90) return "bg-[#F0564A]";
  if (pct >= 70) return "bg-[#F5A524]";
  return "bg-emerald-500";
}

export const MonitoringDashboardCard = memo(function MonitoringDashboardCard({
  resource,
  onNodePointerDown,
}: MonitoringDashboardCardProps) {
  const metric = useSimulationStore((s) => s.metrics[resource.id]);
  const isRestarting = useSimulationStore((s) =>
    s.restarting.includes(resource.id)
  );
  const cpuHistory = useSimulationStore((s) => s.cpuHistory[resource.id]);
  const activeChaos = useSimulationStore((s) => s.activeChaos);

  const chaosEffect = activeChaos.find((c) => c.resourceId === resource.id);

  const health = metric?.health ?? ResourceHealth.HEALTHY;
  const cpu = metric?.cpu ?? 0;
  const memory = metric?.memory ?? 0;

  const isShaking =
    health === ResourceHealth.SATURATED || health === ResourceHealth.DEGRADED;
  const shakeAnimation =
    health === ResourceHealth.SATURATED
      ? "infraforge-shake 0.2s ease-in-out infinite"
      : health === ResourceHealth.DEGRADED
      ? "infraforge-shake-slow 0.6s ease-in-out infinite"
      : undefined;

  const isFailed = health === ResourceHealth.FAILED;
  const hue = hueForType(resource.type);
  const category = CATEGORY_OF_RESOURCE_TYPE[resource.type];
  const chipStyle = healthChipStyles[health];

  return (
    <div
      className={`absolute group pointer-events-auto ${onNodePointerDown ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ left: resource.x, top: resource.y, width: NODE_CARD_WIDTH }}
      onPointerDown={
        onNodePointerDown
          ? (e) => {
              e.stopPropagation();
              onNodePointerDown(resource.id, e.clientX, e.clientY, e.pointerId);
            }
          : undefined
      }
    >
      <div
        className={`border rounded-xl p-3 shadow-lg shadow-black/40 transition-colors duration-300 ${isRestarting ? "ring-2 ring-amber-400/60 animate-pulse" : ""}`}
        style={{
          borderColor: hueBorder(hue),
          background: `linear-gradient(180deg, ${hueTint(hue)} 0%, rgba(21,27,41,0) 45%), #151B29`,
          animation: isShaking ? shakeAnimation : undefined,
          minHeight: NODE_CARD_HEIGHT,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
              style={{ background: hueTile(hue), color: hue }}
            >
              <ResourceIcon type={resource.type} size={14} className="" />
            </span>
            <span className="text-[11px] font-mono text-[#EDF1F7] truncate">
              {resource.id}
            </span>
          </div>
          <span className={`text-[9px] font-mono uppercase font-semibold px-1.5 py-0.5 rounded border ${chipStyle.text} ${chipStyle.border}`}>
            {health}
          </span>
        </div>

        {/* Category micro-label */}
        <div className="mb-2">
          <span className="text-[8px] uppercase tracking-wider font-medium" style={{ color: `${hue}B3` }}>
            {category}
          </span>
        </div>

        {/* SKU */}
        {resource.skuId && (
          <div className="mb-2">
            <span className="text-[9px] font-mono text-[#677185]">
              {resource.skuId}
            </span>
          </div>
        )}

        {/* CPU Bar */}
        <div className="mb-1.5">
          <div className="flex justify-between mb-0.5">
            <span className="text-[9px] font-mono text-[#677185]">CPU</span>
            <span className="text-[10px] font-mono text-[#EDF1F7] tabular-nums">{cpu.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-[#1F2633] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getBarColor(cpu)}`}
              style={{ width: `${Math.min(100, cpu)}%` }}
            />
          </div>
        </div>

        {/* Memory Bar */}
        <div className="mb-2">
          <div className="flex justify-between mb-0.5">
            <span className="text-[9px] font-mono text-[#677185]">MEM</span>
            <span className="text-[10px] font-mono text-[#EDF1F7] tabular-nums">{memory.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-[#1F2633] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getBarColor(memory)}`}
              style={{ width: `${Math.min(100, memory)}%` }}
            />
          </div>
        </div>

        {/* Stats Row */}
        <div className="flex justify-between text-[10px] font-mono tabular-nums mb-2">
          {metric?.rps !== undefined && (
            <div className="flex gap-1">
              <span className="text-[#677185]">RPS</span>
              <span className="text-[#EDF1F7]">{metric.rps}</span>
            </div>
          )}
          {metric?.connections !== undefined && (
            <div className="flex gap-1">
              <span className="text-[#677185]">CONN</span>
              <span className="text-[#EDF1F7]">{metric.connections}</span>
            </div>
          )}
        </div>

        {/* Sparkline */}
        <div className="mb-2">
          <MonitoringCardSparkline
            values={cpuHistory ?? []}
            width={NODE_CARD_WIDTH - 24}
            height={24}
            color={health === ResourceHealth.HEALTHY ? "#10b981" : health === ResourceHealth.DEGRADED ? "#F5A524" : "#F0564A"}
          />
        </div>

        {/* Status Row */}
        {isRestarting && (
          <div className="text-[10px] font-mono font-semibold text-amber-400 text-center mb-1">
            RESTARTING
          </div>
        )}

        {chaosEffect && (
          <div className="text-[10px] font-mono font-semibold text-[#F0564A] text-center">
            {CHAOS_LABELS[chaosEffect.chaosType]} · {chaosEffect.remainingTicks}s
          </div>
        )}

        {/* Smoke Wisps */}
        {isFailed && (
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 pointer-events-none z-10">
            <div className="infraforge-smoke-wisp" style={{ animationDelay: "0s", left: "-6px" }} />
            <div className="infraforge-smoke-wisp" style={{ animationDelay: "0.6s", left: "0px" }} />
            <div className="infraforge-smoke-wisp" style={{ animationDelay: "1.2s", left: "6px" }} />
            <div className="infraforge-smoke-wisp" style={{ animationDelay: "1.8s", left: "3px" }} />
          </div>
        )}
      </div>
    </div>
  );
});