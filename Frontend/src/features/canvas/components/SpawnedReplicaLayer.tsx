import { memo } from "react";
import { useCanvasStore } from "../store/canvasStore";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { BezierConnectionLine } from "./BezierConnectionLine";
import {
  MonitoringDashboardCard,
  NODE_CARD_WIDTH,
  NODE_CARD_HEIGHT,
} from "@/features/monitoring/components/MonitoringDashboardCard";
import { ProvisioningNode } from "@/features/monitoring/components/ProvisioningNode";
import { RESOURCE_TYPES } from "@shared/constants/RESOURCE_TYPES.constants";
import type { Resource } from "@shared/interface/Resource.interface";
import type { SpawnedVmInfo } from "@shared/interface/SpawnedVmInfo.interface";

interface ReplicaLink {
  vm: SpawnedVmInfo;
  lb: Resource;
}

/* Engine-owned autoscaled replicas on the unified canvas: lb→replica link
tubes, live replica cards, and provisioning ghosts. Replicas are NOT
draggable, selectable, or deletable — wrappers are pointer-events-none and
cards render as content only (no ports, no delete chip).
Re-renders are driven by ONE stable primitive key so 1Hz snapshots that
change nothing visible never touch this layer. */
export const SpawnedReplicaLayer = memo(function SpawnedReplicaLayer() {
  const liveMode = useCanvasStore((s) => s.liveMode);
  const scale = useCanvasStore((s) => s.scale);
  // Boolean selectors: stable across 1Hz snapshots, no extra re-renders.
  const simulationRunning = useSimulationStore(
    (s) => s.simulatedSeconds > 0 && s.speed > 0,
  );
  // Subscription-only primitive key: id:status:x:y:poolId per replica (the
  // poolId keeps lb-link changes in the key). A change here is the ONLY
  // snapshot-driven reason this layer re-renders; the fresh arrays are read
  // via getState() at render time below.
  useSimulationStore((s) =>
    s.spawnedVms
      .map((v) => `${v.id}:${v.status}:${v.x}:${v.y}:${v.poolId}`)
      .join("|"),
  );

  if (!liveMode) return null;

  const { spawnedVms, pools } = useSimulationStore.getState();
  const resources = useCanvasStore.getState().resources;
  const resourceById = new Map(resources.map((r) => [r.id, r]));

  // lb → replica link tubes: only while the pool's lb still exists on canvas.
  const linkTubes: ReplicaLink[] = [];
  for (const vm of spawnedVms) {
    const pool = pools[vm.poolId];
    if (!pool) continue;
    const lb = resourceById.get(pool.lbId);
    if (!lb) continue;
    linkTubes.push({ vm, lb });
  }
  const activeVms = spawnedVms.filter((v) => v.status === "active");
  const provisioningVms = spawnedVms.filter((v) => v.status === "provisioning");

  return (
    <>
      {/* lb -> replica link tubes, under every card (z-0) */}
      <svg
        className="absolute inset-0 pointer-events-none z-0"
        width="100%"
        height="100%"
        style={{ overflow: "visible" }}
      >
        {linkTubes.map(({ vm, lb }) => (
          <BezierConnectionLine
            key={`replica-link-${vm.id}`}
            source={lb}
            target={{ x: vm.x, y: vm.y, type: RESOURCE_TYPES.VirtualMachine }}
            port={80}
            scale={scale}
            nodeWidth={NODE_CARD_WIDTH}
            nodeHeight={NODE_CARD_HEIGHT}
            showPackets={liveMode}
            animatePackets={simulationRunning}
          />
        ))}
      </svg>
      {/* Active replica cards: engine-owned, never interactive */}
      {activeVms.map((vm) => (
        <div
          key={vm.id}
          className="absolute z-10 pointer-events-none"
          style={{ left: vm.x, top: vm.y, width: NODE_CARD_WIDTH }}
        >
          <MonitoringDashboardCard
            mode="live"
            asContent
            resource={{
              id: vm.id,
              type: RESOURCE_TYPES.VirtualMachine,
              x: vm.x,
              y: vm.y,
            }}
          />
        </div>
      ))}
      {/* Provisioning ghosts */}
      {provisioningVms.map((vm) => (
        <ProvisioningNode key={vm.id} vm={vm} />
      ))}
    </>
  );
});