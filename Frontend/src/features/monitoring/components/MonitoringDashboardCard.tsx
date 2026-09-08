import { memo } from "react";
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { useSimulationStore } from "../store/simulationStore";
import { ResourceHealth } from "@shared/enum/ResourceHealth.enum";
import { MonitoringCardSparkline } from "./MonitoringCardSparkline";
import { CHAOS_LABELS } from "@shared/constants/CHAOS_LABELS.constants";
import { RESOURCE_TYPES } from "@shared/constants/RESOURCE_TYPES.constants";
import { CAPACITY } from "@shared/constants/CAPACITY.constants";
import { SIMULATION_CONSTANTS } from "@shared/constants/SIMULATION_CONSTANTS.constants";
import { findSku } from "@shared/catalog/index";
import { hueForType, hueBorder, hueTint, hueTile } from "@/theme/resourceCategoryHues";
import type { Resource } from "@shared/interface/Resource.interface";

// Compact Excalidraw-scale footprint: ~208px wide nodes. HEIGHT is the
// footprint/anchor constant (overlap guards + line anchors); design cards
// settle near it, live cards may grow slightly with content.
export const NODE_CARD_WIDTH = 208;
export const NODE_CARD_HEIGHT = 160;

interface MonitoringDashboardCardProps {
  resource: Resource;
  onNodePointerDown?: (
    nodeId: string,
    clientX: number,
    clientY: number,
    pointerId: number,
  ) => void;
  scale?: number;
  mode?: "design" | "live";
  asContent?: boolean;
}

const healthChipStyles: Record<string, { text: string; border: string; dotBg: string }> = {
  [ResourceHealth.HEALTHY]: { text: "text-emerald-400", border: "border-emerald-400/40", dotBg: "bg-emerald-400" },
  [ResourceHealth.DEGRADED]: { text: "text-amber-400", border: "border-amber-400/40", dotBg: "bg-amber-400" },
  [ResourceHealth.SATURATED]: { text: "text-red-400", border: "border-red-400/40", dotBg: "bg-red-400" },
  [ResourceHealth.FAILED]: { text: "text-red-500", border: "border-red-500/40", dotBg: "bg-red-500" },
};

const healthColorHex: Record<string, string> = {
  [ResourceHealth.HEALTHY]: "#34d399",
  [ResourceHealth.DEGRADED]: "#fbbf24",
  [ResourceHealth.SATURATED]: "#f87171",
  [ResourceHealth.FAILED]: "#ef4444",
};

function getBarColor(pct: number): string {
  if (pct >= 90) return "bg-[#F0564A]";
  if (pct >= 70) return "bg-[#F5A524]";
  return "bg-emerald-500";
}

export const MonitoringDashboardCard = memo(function MonitoringDashboardCard({
  resource,
  onNodePointerDown,
  mode = "live",
  asContent = false,
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
  const chipStyle = healthChipStyles[health];
  const healthColor = healthColorHex[health];

  const sku = resource.skuId ? findSku(resource.skuId) : undefined;
  const isVmType = resource.type === RESOURCE_TYPES.VirtualMachine;
  let declaredCapacity: number;
  let capacityUnit: string;
  if (sku) {
    const perVcpu = isVmType
      ? SIMULATION_CONSTANTS.RPS_PER_VCPU
      : SIMULATION_CONSTANTS.QPS_PER_VCPU;
    declaredCapacity = Math.round(sku.vCpu * sku.baselineFactor * perVcpu);
    capacityUnit = isVmType ? "rps" : "qps";
  } else {
    declaredCapacity = CAPACITY[resource.type].rps;
    capacityUnit = "rps";
  }

  const showAutoscalingChip =
    resource.type === RESOURCE_TYPES.LoadBalancer &&
    resource.autoscaling?.enabled !== false;
  const hasAutoscalingRange =
    resource.autoscaling?.minReplicas !== undefined &&
    resource.autoscaling?.maxReplicas !== undefined;
  const autoscalingRange = hasAutoscalingRange
    ? `${resource.autoscaling!.minReplicas}-${resource.autoscaling!.maxReplicas}`
    : null;
  const targetCpuDisplay = resource.autoscaling?.targetCpu ?? 75;

  const heroValue = mode === "design" ? declaredCapacity : (metric?.rps ?? 0);
  const heroUnit = mode === "design" ? capacityUnit : "rps";

  // Node naming UI: the user-set name leads; the id stays as the tooltip.
  const displayName = resource.name || resource.id;
  const titleText = resource.name ? `${resource.name} · ${resource.id}` : resource.id;

  const cardBody = (
    <div
      className={`relative overflow-hidden border rounded-xl p-3 shadow-lg shadow-black/40 transition-colors duration-300 ${isRestarting ? "ring-2 ring-amber-400/60 animate-pulse" : ""}`}
      style={{
        borderColor: hueBorder(hue),
        background: `linear-gradient(180deg, ${hueTint(hue)} 0%, rgba(21,27,41,0) 45%), #151B29`,
        animation: isShaking ? shakeAnimation : undefined,
        minHeight: NODE_CARD_HEIGHT,
      }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-white/10 to-transparent pointer-events-none" />
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
            style={{ background: hueTile(hue), color: hue }}
          >
            <ResourceIcon type={resource.type} size={14} className="" />
          </span>
          <span
            className="text-[13px] font-mono font-semibold text-[#EDF1F7] truncate"
            title={titleText}
          >
            {displayName}
          </span>
        </div>
        <span
          className={`flex items-center gap-1 text-[9px] font-mono uppercase font-semibold px-1.5 py-0.5 rounded-full border ${chipStyle.text} ${chipStyle.border}`}
          style={{ background: `${healthColor}14` }}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${chipStyle.dotBg}`}
            style={{ boxShadow: `0 0 6px ${healthColor}, 0 0 12px ${healthColor}80` }}
          />
          {health}
        </span>
      </div>
      {/* Hero metric */}
      <div className="flex items-baseline gap-1.5 mb-1.5">
        <span className="text-[18px] font-mono font-semibold text-[#EDF1F7] tabular-nums leading-none">
          {heroValue.toLocaleString()}
        </span>
        <span className="text-[9px] font-mono uppercase tracking-wider text-[#677185]">
          {heroUnit}
        </span>
      </div>
      {mode === "design" ? (
        <>
          <div className="space-y-1 text-[10px] font-mono mb-1.5">
            <div className="flex justify-between">
              <span className="text-[#677185]">INSTANCE</span>
              <span className="text-[#AAB4C5] truncate max-w-28">
                {resource.skuId ?? "generic"}
              </span>
            </div>
            {showAutoscalingChip && (
              <div className="flex justify-between">
                <span className="text-[#677185]">POOL</span>
                <span className="text-[#AAB4C5]">
                  {autoscalingRange ?? "auto"} · {targetCpuDisplay}%
                </span>
              </div>
            )}
          </div>
          <MonitoringCardSparkline
            values={cpuHistory ?? []}
            width={NODE_CARD_WIDTH - 24}
            height={28}
            color={hue}
          />
        </>
      ) : (
        <>
          <div className="mb-1">
            <div className="flex justify-between mb-0.5">
              <span className="text-[9px] font-mono text-[#677185]">CPU</span>
              <span className="text-[10px] font-mono text-[#EDF1F7] tabular-nums">{cpu.toFixed(1)}%</span>
            </div>
            <div className="h-1 rounded-full bg-[#1F2633] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${getBarColor(cpu)}`}
                style={{ width: `${Math.min(100, cpu)}%` }}
              />
            </div>
          </div>
          <div className="mb-1.5">
            <div className="flex justify-between mb-0.5">
              <span className="text-[9px] font-mono text-[#677185]">MEM</span>
              <span className="text-[10px] font-mono text-[#EDF1F7] tabular-nums">{memory.toFixed(1)}%</span>
            </div>
            <div className="h-1 rounded-full bg-[#1F2633] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${getBarColor(memory)}`}
                style={{ width: `${Math.min(100, memory)}%` }}
              />
            </div>
          </div>
          <div className="flex justify-between text-[10px] font-mono tabular-nums mb-1.5">
            {metric?.rps !== undefined && (
              <div className="flex gap-1.5">
                <span className="text-[#677185]">RPS</span>
                <span className="text-[#EDF1F7]">{metric.rps}</span>
              </div>
            )}
            {metric?.connections !== undefined && (
              <div className="flex gap-1.5">
                <span className="text-[#677185]">CONN</span>
                <span className="text-[#EDF1F7]">{metric.connections}</span>
              </div>
            )}
          </div>
          {isRestarting && (
            <div className="text-[10px] font-mono font-semibold text-amber-400 text-center mb-0.5">
              RESTARTING
            </div>
          )}
          <div className="mb-1">
            <MonitoringCardSparkline
              values={cpuHistory ?? []}
              width={NODE_CARD_WIDTH - 24}
              height={28}
              color={hue}
            />
          </div>
          {chaosEffect && (
            <div className="mt-1.5 -mx-3 -mb-3 px-3 py-1.5 rounded-b-xl bg-[rgba(240,86,74,0.10)] border-t border-[rgba(240,86,74,0.35)] flex items-center justify-between">
              <span className="text-[10px] font-mono font-semibold text-[#F0564A]">
                {CHAOS_LABELS[chaosEffect.chaosType]}
              </span>
              <span className="text-[10px] font-mono text-[#F0564A] tabular-nums">
                {chaosEffect.remainingTicks}s
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );

  const smokeWisps = isFailed ? (
    <div className="absolute -top-1 left-1/2 -translate-x-1/2 pointer-events-none z-10">
      <div className="infraforge-smoke-wisp" style={{ animationDelay: "0s", left: "-6px" }} />
      <div className="infraforge-smoke-wisp" style={{ animationDelay: "0.6s", left: "0px" }} />
      <div className="infraforge-smoke-wisp" style={{ animationDelay: "1.2s", left: "6px" }} />
      <div className="infraforge-smoke-wisp" style={{ animationDelay: "1.8s", left: "3px" }} />
    </div>
  ) : null;

  if (asContent) {
    return (
      <>
        {cardBody}
        {smokeWisps}
      </>
    );
  }

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
      {cardBody}
      {smokeWisps}
    </div>
  );
});