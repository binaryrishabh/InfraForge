import { ResourceIcon } from "@/components/common/ResourceIcon";
import { useSimulationStore } from "../store/simulationStore";
import { ResourceHealth } from "@shared/enum/ResourceHealth.enum";
import type { Resource } from "@shared/interface/Resource.interface";

interface MonitoringResourceNodeProps {
  resource: Resource;
  // Optional cosmetic drag hook (monitoring only). Not wired on the designer.
  onNodePointerDown?: (nodeId: string, clientX: number, clientY: number, pointerId: number) => void;
};

const healthRing: Record<string, string> = {
  [ResourceHealth.HEALTHY]: "ring-emerald-500/60",
  [ResourceHealth.DEGRADED]: "ring-amber-400",
  [ResourceHealth.SATURATED]: "ring-red-500 animate-pulse",
  [ResourceHealth.FAILED]: "ring-red-600 animate-pulse"
};

const healthText: Record<string, string> = {
  [ResourceHealth.HEALTHY]: "text-emerald-400",
  [ResourceHealth.DEGRADED]: "text-amber-400",
  [ResourceHealth.SATURATED]: "text-red-400",
  [ResourceHealth.FAILED]: "text-red-500"
};

function HudRow({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div>
      <div className="flex justify-between text-[9px] font-mono mb-0.5">
        <span className="text-[#677185]">{label}</span>
        <span className="text-[#AAB4C5]">{value}</span>
      </div>
      <div className="h-1 rounded-full bg-[#1F2633] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${pct >= 90 ? "bg-[#F0564A]" : pct >= 70 ? "bg-[#F5A524]" : "bg-emerald-500"}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
};

export function MonitoringResourceNode({ resource, onNodePointerDown }: MonitoringResourceNodeProps) {
  const metric = useSimulationStore((s) => s.metrics[resource.id]);
  const isRestarting = useSimulationStore((s) => s.restarting.includes(resource.id));

  const health = metric?.health ?? ResourceHealth.HEALTHY;
  const cpu = metric?.cpu ?? 0;
  const memory = metric?.memory ?? 0;
  const showAutoPop =
    isRestarting ||
    health === ResourceHealth.DEGRADED ||
    health === ResourceHealth.SATURATED ||
    health === ResourceHealth.FAILED;
  const popNearTop = resource.y < 96;

  return (
    <div
      className={`absolute group pointer-events-auto ${onNodePointerDown ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ left: resource.x, top: resource.y }}
      onPointerDown={
        onNodePointerDown
          ? (e) => {
              e.stopPropagation();
              onNodePointerDown(resource.id, e.clientX, e.clientY, e.pointerId);
            }
          : undefined
      }
    >
      {/* AUTO-POP METER — appears uninvited when a resource crosses its safe threshold or is restarting.
          Flips to the right of the node when the node sits near the canvas top edge so it never clips. */}
      {showAutoPop && (
        <div
          className={`${
            popNearTop
              ? "absolute left-full top-0 ml-2"
              : "absolute -top-16 left-1/2 -translate-x-1/2"
          } w-32 bg-[#0B0E14]/95 border rounded-lg px-2 py-1.5 shadow-xl z-30 ${
            isRestarting
              ? "border-[#F5A524]/60"
              : health === ResourceHealth.SATURATED || health === ResourceHealth.FAILED
              ? "border-[#F0564A]/60"
              : "border-[#F5A524]/60"
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-mono text-[#AAB4C5] truncate max-w-17.5">{resource.id}</span>
            {isRestarting ? (
              <span className="text-[10px] font-mono font-semibold text-amber-400">RESTARTING</span>
            ) : (
              <span className={`text-[10px] font-mono font-semibold ${healthText[health]}`}>{cpu}%</span>
            )}
          </div>
          <div className="h-1 rounded-full bg-[#1F2633] overflow-hidden">
            {isRestarting ? (
              <div className="h-full w-full rounded-full bg-[#F5A524] animate-pulse" />
            ) : (
              <div
                className={`h-full rounded-full transition-all duration-500 ${cpu >= 90 ? "bg-[#F0564A]" : "bg-[#F5A524]"}`}
                style={{ width: `${Math.min(100, cpu)}%` }}
              />
            )}
          </div>
          <p className={`text-[8px] font-mono mt-0.5 ${isRestarting ? "text-amber-400" : healthText[health]}`}>
            {isRestarting ? "RESTARTING" : health.toUpperCase()}
          </p>
        </div>
      )}

      {/* NODE with health-driven ring (amber pulse while a vertical SKU swap restarts it) */}
      <div
        title={resource.type}
        className={`w-12 h-12 rounded-lg bg-[#12161F] ring-2 flex items-center justify-center transition-colors duration-300 ${
          isRestarting ? "ring-amber-400 animate-pulse" : healthRing[health]
        }`}
      >
        <ResourceIcon type={resource.type} size={20} className={healthText[health]} />
      </div>

      {/* HOVER HUD */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-40 bg-[#0B0E14]/95 border border-[#273042] rounded-lg p-2 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-40">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-mono text-[#EDF1F7] truncate">{resource.id}</span>
          <span className={`text-[9px] font-mono ${healthText[health]}`}>{health.toUpperCase()}</span>
        </div>
        <div className="space-y-1">
          <HudRow label="CPU" value={`${cpu}%`} pct={cpu} />
          <HudRow label="MEM" value={`${memory}%`} pct={memory} />
          {metric?.rps !== undefined && (
            <div className="flex justify-between text-[9px] font-mono">
              <span className="text-[#677185]">RPS</span>
              <span className="text-[#AAB4C5]">{metric.rps}</span>
            </div>
          )}
          {metric?.connections !== undefined && (
            <div className="flex justify-between text-[9px] font-mono">
              <span className="text-[#677185]">CONN</span>
              <span className="text-[#AAB4C5]">{metric.connections}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};