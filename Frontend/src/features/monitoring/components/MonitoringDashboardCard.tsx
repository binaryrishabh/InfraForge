import { memo } from "react";
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { useSimulationStore } from "../store/simulationStore";
import { ResourceHealth } from "@shared/enum/ResourceHealth.enum";
import { MonitoringCardSparkline } from "./MonitoringCardSparkline";
import { CHAOS_LABELS } from "@shared/constants/CHAOS_LABELS.constants";
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

const healthBorderColor: Record<string, string> = {
  [ResourceHealth.HEALTHY]: "border-[#273042]",
  [ResourceHealth.DEGRADED]: "border-amber-400/60",
  [ResourceHealth.SATURATED]: "border-red-500/60",
  [ResourceHealth.FAILED]: "border-red-600/60",
};

const healthTextColor: Record<string, string> = {
  [ResourceHealth.HEALTHY]: "text-emerald-400",
  [ResourceHealth.DEGRADED]: "text-amber-400",
  [ResourceHealth.SATURATED]: "text-red-400",
  [ResourceHealth.FAILED]: "text-red-500",
};

function getBarColor(pct: number): string {
  if (pct >= 90) return "bg-[#F0564A]";
  if (pct >= 70) return "bg-[#F5A524]";
  return "bg-emerald-500";
}

export const MonitoringDashboardCard = memo(function MonitoringDashboardCard({
  resource,
  onNodePointerDown,
  // scale stays in the prop contract for callers (reserved for a future
  // level-of-detail pass); the card renders at a fixed size, so it is not
  // destructured here.
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
        className={`bg-[#12161F] border rounded-lg p-3 shadow-lg transition-colors duration-300 ${healthBorderColor[health]} ${isRestarting ? "ring-2 ring-amber-400/60 animate-pulse" : ""}`}
        style={{
          animation: isShaking ? shakeAnimation : undefined,
          minHeight: NODE_CARD_HEIGHT,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <ResourceIcon type={resource.type} size={16} className={healthTextColor[health]} />
            <span className="text-[11px] font-mono text-[#EDF1F7] truncate">
              {resource.id}
            </span>
          </div>
          <span className={`text-[9px] font-mono uppercase font-semibold ${healthTextColor[health]}`}>
            {health}
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
          <div className="flex justify-between text-[10px] font-mono mb-0.5">
            <span className="text-[#677185]">CPU</span>
            <span className="text-[#AAB4C5]">{cpu.toFixed(1)}%</span>
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
          <div className="flex justify-between text-[10px] font-mono mb-0.5">
            <span className="text-[#677185]">MEM</span>
            <span className="text-[#AAB4C5]">{memory.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-[#1F2633] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getBarColor(memory)}`}
              style={{ width: `${Math.min(100, memory)}%` }}
            />
          </div>
        </div>

        {/* Stats Row */}
        <div className="flex justify-between text-[10px] font-mono text-[#AAB4C5] mb-2">
          {metric?.rps !== undefined && (
            <div className="flex gap-1">
              <span className="text-[#677185]">RPS</span>
              <span>{metric.rps}</span>
            </div>
          )}
          {metric?.connections !== undefined && (
            <div className="flex gap-1">
              <span className="text-[#677185]">CONN</span>
              <span>{metric.connections}</span>
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