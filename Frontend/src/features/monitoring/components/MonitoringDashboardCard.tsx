import { memo } from "react";
import { useSimulationStore } from "../store/simulationStore";
import { ResourceHealth } from "@shared/enum/ResourceHealth.enum";
import { MonitoringCardSparkline } from "./MonitoringCardSparkline";
import { RESOURCE_TYPES } from "@shared/constants/RESOURCE_TYPES.constants";
import { CAPACITY } from "@shared/constants/CAPACITY.constants";
import { SIMULATION_CONSTANTS } from "@shared/constants/SIMULATION_CONSTANTS.constants";
import { findSku } from "@shared/catalog/index";
import { hueForType } from "@/theme/resourceCategoryHues";
import type { Resource } from "@shared/interface/Resource.interface";
import { CardShell } from "./card/CardShell";
import { DesignCardHeader } from "./card/DesignCardHeader";
import { LiveCardHeader } from "./card/LiveCardHeader";
import { CardHeroMetric } from "./card/CardHeroMetric";
import { DesignCardFooter } from "./card/DesignCardFooter";
import { LiveTelemetryBlock } from "./card/LiveTelemetryBlock";
import { ChaosAccentStrip } from "./card/ChaosAccentStrip";
import { SmokeWisps } from "./card/SmokeWisps";

// Compact Excalidraw-scale footprint: ~208px wide nodes. NODE_CARD_HEIGHT is
// the LIVE footprint/anchor constant (overlap guards + line anchors); the
// design state settles at the shorter DESIGN_CARD_HEIGHT so the drafting
// card reads as a compact tile instead of a half-empty panel.
export const NODE_CARD_WIDTH = 208;
export const NODE_CARD_HEIGHT = 160;
export const DESIGN_CARD_HEIGHT = 120;

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

  const shakeAnimation =
    health === ResourceHealth.SATURATED
      ? "infraforge-shake 0.2s ease-in-out infinite"
      : health === ResourceHealth.DEGRADED
        ? "infraforge-shake-slow 0.6s ease-in-out infinite"
        : undefined;
  const isFailed = health === ResourceHealth.FAILED;
  const hue = hueForType(resource.type);

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
  const displayName = resource.name || resource.id;
  const titleText = resource.name ? `${resource.name} · ${resource.id}` : resource.id;
  const minHeight = mode === "design" ? DESIGN_CARD_HEIGHT : NODE_CARD_HEIGHT;

  const cardBody = (
    <CardShell
      hue={hue}
      isRestarting={isRestarting}
      shakeAnimation={shakeAnimation}
      minHeight={minHeight}
    >
      {mode === "design" ? (
        <>
          <DesignCardHeader
            type={resource.type}
            displayName={displayName}
            titleText={titleText}
            hue={hue}
          />
          <CardHeroMetric value={heroValue} unit={heroUnit} />
          <DesignCardFooter
            showPool={showAutoscalingChip}
            poolText={`pool ${autoscalingRange ?? "auto"} · ${targetCpuDisplay}%`}
            instanceText={resource.skuId ?? "generic"}
          />
        </>
      ) : (
        <>
          <LiveCardHeader
            type={resource.type}
            displayName={displayName}
            titleText={titleText}
            hue={hue}
            health={health}
          />
          <CardHeroMetric value={heroValue} unit={heroUnit} />
          <LiveTelemetryBlock
            cpu={cpu}
            memory={memory}
            rps={metric?.rps}
            connections={metric?.connections}
            isRestarting={isRestarting}
          />
          <div className="mb-1">
            <MonitoringCardSparkline
              values={cpuHistory ?? []}
              width={NODE_CARD_WIDTH - 24}
              height={28}
              color={hue}
            />
          </div>
          {chaosEffect && <ChaosAccentStrip effect={chaosEffect} />}
        </>
      )}
    </CardShell>
  );

  const smokeWisps = isFailed ? <SmokeWisps /> : null;

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