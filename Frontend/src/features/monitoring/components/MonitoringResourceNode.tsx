import { ResourceIcon } from "@/components/common/ResourceIcon";
import { useSimulationStore } from "../store/simulationStore";
import { ResourceHealth } from "@shared/enum/ResourceHealth.enum";
import type { Resource } from "@shared/interface/Resource.interface";

interface MonitoringResourceNodeProps {
  resource: Resource;
  // Optional cosmetic drag hook (monitoring only). Not wired on the designer.
  onNodePointerDown?: (
    nodeId: string,
    clientX: number,
    clientY: number,
    pointerId: number,
  ) => void;
  // World zoom level; used only to keep the icon readable when zoomed out.
  scale?: number;
  // Viewport translate + canvas container size; used to place overlays in true
  // screen space so they only flip when they would actually clip an edge.
  translateX?: number;
  translateY?: number;
  containerWidth?: number;
  containerHeight?: number;
}

// Estimated overlay base sizes (screen px at overlayScale = 1) used only to
// decide which side an overlay fits on. Slightly generous so we flip a touch
// early rather than let an overlay clip.
const METER_BASE_W = 144; // w-36
const METER_BASE_H = 56;
const HUD_BASE_W = 160; // w-40
const HUD_BASE_H = 110;
const EDGE_GAP = 8;

const healthRing: Record<string, string> = {
  [ResourceHealth.HEALTHY]: "ring-emerald-500/60",
  [ResourceHealth.DEGRADED]: "ring-amber-400",
  [ResourceHealth.SATURATED]: "ring-red-500 animate-pulse",
  [ResourceHealth.FAILED]: "ring-red-600 animate-pulse",
};

const healthText: Record<string, string> = {
  [ResourceHealth.HEALTHY]: "text-emerald-400",
  [ResourceHealth.DEGRADED]: "text-amber-400",
  [ResourceHealth.SATURATED]: "text-red-400",
  [ResourceHealth.FAILED]: "text-red-500",
};

function HudRow({
  label,
  value,
  pct,
}: {
  label: string;
  value: string;
  pct: number;
}) {
  return (
    <div>
      <div className="flex justify-between text-[10px] font-mono mb-0.5">
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
}

export function MonitoringResourceNode({
  resource,
  onNodePointerDown,
  scale = 1,
  translateX = 0,
  translateY = 0,
  containerWidth = 0,
  containerHeight = 0,
}: MonitoringResourceNodeProps) {
  const metric = useSimulationStore((s) => s.metrics[resource.id]);
  const isRestarting = useSimulationStore((s) =>
    s.restarting.includes(resource.id),
  );

  const health = metric?.health ?? ResourceHealth.HEALTHY;
  const cpu = metric?.cpu ?? 0;
  const memory = metric?.memory ?? 0;
  const showAutoPop =
    isRestarting ||
    health === ResourceHealth.DEGRADED ||
    health === ResourceHealth.SATURATED ||
    health === ResourceHealth.FAILED;

  // Readable-zoom: grow the icon up to 1.75x as the world zooms out.
  const inverseScale = scale < 1 ? Math.min(1 / scale, 1.75) : 1;
  // Counter-scale for the screen-space overlays (auto-pop meter + hover HUD) so
  // they stay full size when zoomed out, capped at 3x so they never get absurd
  // at the 0.3 minimum zoom.
  const overlayScale = scale < 1 ? Math.min(1 / scale, 3) : 1;
  // Net screen-space scale of the overlays (world scale x counter-scale).
  const overlayScreenScale = scale * overlayScale;

  // --- Cinematic layer state ---
  // Saturated resources shake hard and fast; degraded resources get a slow,
  // subtle tremble. Failed resources don't shake — they smoke instead.
  const isShaking =
    health === ResourceHealth.SATURATED || health === ResourceHealth.DEGRADED;
  const shakeAnimation =
    health === ResourceHealth.SATURATED
      ? "infraforge-shake 0.2s ease-in-out infinite"
      : health === ResourceHealth.DEGRADED
        ? "infraforge-shake-slow 0.6s ease-in-out infinite"
        : undefined;
  const isFailed = health === ResourceHealth.FAILED;

  // --- True screen-space geometry for edge-aware overlay placement ---
  const nodeScreenX = translateX + resource.x * scale;
  const nodeScreenY = translateY + resource.y * scale;
  const nodeScreenSize = 48 * scale;
  const meterW = METER_BASE_W * overlayScreenScale;
  const meterH = METER_BASE_H * overlayScreenScale;
  const hudW = HUD_BASE_W * overlayScreenScale;
  const hudH = HUD_BASE_H * overlayScreenScale;

  // Auto-pop meter: prefer top, then RIGHT, then left, then bottom.
  // Only flips right when it would actually clip the top edge.
  const meterFitsAbove = nodeScreenY - EDGE_GAP - meterH >= 0;
  const meterFitsRight =
    nodeScreenX + nodeScreenSize + EDGE_GAP + meterW <= containerWidth;
  const meterFitsLeft = nodeScreenX - EDGE_GAP - meterW >= 0;
  const meterSide = meterFitsAbove
    ? "top"
    : meterFitsRight
      ? "right"
      : meterFitsLeft
        ? "left"
        : "bottom";

  // Hover HUD: prefer bottom, then LEFT, then right, then top.
  // Avoids the bottom edge AND the right edge (bottom-right corner case).
  const hudFitsBelow =
    nodeScreenY + nodeScreenSize + EDGE_GAP + hudH <= containerHeight;
  const hudFitsRight =
    nodeScreenX + nodeScreenSize + EDGE_GAP + hudW <= containerWidth;
  const hudFitsLeft = nodeScreenX - EDGE_GAP - hudW >= 0;
  const hudSide = hudFitsBelow
    ? "bottom"
    : hudFitsLeft
      ? "left"
      : hudFitsRight
        ? "right"
        : "top";

  // Meter prefers top/right, HUD prefers bottom/left -> they pick opposite sides
  // and stop overlapping each other. Meter gets the higher z so if they ever do
  // collide, the alert stays visible.
  const meterPosClass = {
    top: "absolute left-1/2 -translate-x-1/2 -top-16",
    right: "absolute left-full top-0 ml-2",
    left: "absolute right-full top-0 mr-2",
    bottom: "absolute left-1/2 -translate-x-1/2 top-full mt-2",
  }[meterSide];
  const meterOrigin = {
    top: "bottom center",
    right: "left center",
    left: "right center",
    bottom: "top center",
  }[meterSide];

  const hudPosClass = {
    bottom: "absolute left-1/2 -translate-x-1/2 top-full mt-2",
    left: "absolute right-full top-0 mr-2",
    right: "absolute left-full top-0 ml-2",
    top: "absolute left-1/2 -translate-x-1/2 -top-16",
  }[hudSide];
  const hudOrigin = {
    bottom: "top center",
    left: "right center",
    right: "left center",
    top: "bottom center",
  }[hudSide];

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
pointer-events-none so the counter-scaled meter never enlarges the node's
hover/drag hit region. Flips side only when it would actually clip an edge. */}
      {showAutoPop && (
        <div className={`${meterPosClass} z-50 pointer-events-none`}>
          <div
            style={{
              transform: `scale(${overlayScale})`,
              transformOrigin: meterOrigin,
            }}
          >
            <div
              className={`w-36 bg-[#0B0E14]/95 border rounded-lg px-2 py-1.5 shadow-xl ${
                isRestarting
                  ? "border-[#F5A524]/60"
                  : health === ResourceHealth.SATURATED ||
                      health === ResourceHealth.FAILED
                    ? "border-[#F0564A]/60"
                    : "border-[#F5A524]/60"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono text-[#AAB4C5] truncate max-w-24">
                  {resource.id}
                </span>
                {isRestarting ? (
                  <span className="text-[12px] font-mono font-semibold text-amber-400">
                    RESTARTING
                  </span>
                ) : (
                  <span
                    className={`text-[12px] font-mono font-semibold ${healthText[health]}`}
                  >
                    {cpu}%
                  </span>
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
              <p
                className={`text-[9px] font-mono mt-0.5 ${isRestarting ? "text-amber-400" : healthText[health]}`}
              >
                {isRestarting ? "RESTARTING" : health.toUpperCase()}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* NODE with health-driven ring (amber pulse while a vertical SKU swap restarts it).
Shakes hard+fast when saturated, slow+subtle when degraded. */}
      <div
        title={resource.type}
        className={`w-12 h-12 rounded-lg bg-[#12161F] ring-2 flex items-center justify-center transition-colors duration-300 ${
          isRestarting ? "ring-amber-400 animate-pulse" : healthRing[health]
        }`}
        style={{
          animation: isShaking ? shakeAnimation : undefined,
        }}
      >
        {/* Icon is inverse-scaled so it stays readable when zoomed out. */}
        <span
          className="inline-flex items-center justify-center"
          style={{
            transform: `scale(${inverseScale})`,
            transformOrigin: "center",
          }}
        >
          <ResourceIcon
            type={resource.type}
            size={20}
            className={healthText[health]}
          />
        </span>
      </div>

      {/* SMOKE WISPS — rising smoke rendered only when the resource has failed. */}
      {isFailed && (
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 pointer-events-none z-10">
          <div
            className="infraforge-smoke-wisp"
            style={{ animationDelay: "0s", left: "-6px" }}
          />
          <div
            className="infraforge-smoke-wisp"
            style={{ animationDelay: "0.6s", left: "0px" }}
          />
          <div
            className="infraforge-smoke-wisp"
            style={{ animationDelay: "1.2s", left: "6px" }}
          />
          <div
            className="infraforge-smoke-wisp"
            style={{ animationDelay: "1.8s", left: "3px" }}
          />
        </div>
      )}

      {/* HOVER HUD — pointer-events-none on the wrapper so the counter-scaled HUD
never enlarges the node's hover/drag hit region. It still appears on node
hover because `group` is on the node ancestor. Flips side only when it
would actually clip the bottom/right/left edge. */}
      <div className={`${hudPosClass} z-40 pointer-events-none`}>
        <div
          style={{
            transform: `scale(${overlayScale})`,
            transformOrigin: hudOrigin,
          }}
        >
          <div className="w-40 bg-[#0B0E14]/95 border border-[#273042] rounded-lg p-2 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-mono text-[#EDF1F7] truncate">
                {resource.id}
              </span>
              <span className={`text-[10px] font-mono ${healthText[health]}`}>
                {health.toUpperCase()}
              </span>
            </div>
            <div className="space-y-1">
              <HudRow label="CPU" value={`${cpu}%`} pct={cpu} />
              <HudRow label="MEM" value={`${memory}%`} pct={memory} />
              {metric?.rps !== undefined && (
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-[#677185]">RPS</span>
                  <span className="text-[#AAB4C5]">{metric.rps}</span>
                </div>
              )}
              {metric?.connections !== undefined && (
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-[#677185]">CONN</span>
                  <span className="text-[#AAB4C5]">{metric.connections}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
