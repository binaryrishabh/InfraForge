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
import { replicaSlotPositions } from "../utils/replicaSlotLayout";
import { RESOURCE_TYPES } from "@shared/constants/RESOURCE_TYPES.constants";
import type { Resource } from "@shared/interface/Resource.interface";
import type { SpawnedVmInfo } from "@shared/interface/SpawnedVmInfo.interface";

interface ReplicaLink {
  vm: SpawnedVmInfo;
  lb: Resource;
  x: number;
  y: number;
}

/* Engine-owned autoscaled replicas on the unified canvas: lb→replica link
tubes, live replica cards, and provisioning ghosts. Replicas are NOT
draggable, selectable, or deletable — wrappers are pointer-events-none and
cards render as content only (no ports, no delete chip).
Render positions come from replicaSlotPositions (tidy scattered free slots)
instead of the engine's fixed downward stack, so drain cycles never leave
holes. Re-renders stay driven by primitive keys only. */
export const SpawnedReplicaLayer = memo(function SpawnedReplicaLayer() {
  const liveMode = useCanvasStore((s) => s.liveMode);
  const scale = useCanvasStore((s) => s.scale);
  // Slot layout depends on the canvas cards too, so subscribe to them:
  // identity changes only on real edits, never on 1Hz snapshots.
  const resources = useCanvasStore((s) => s.resources);
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
  const positions = replicaSlotPositions(spawnedVms, resources, pools);
  const resourceById = new Map(resources.map((r) => [r.id, r]));

  const slotOf = (vm: SpawnedVmInfo) =>
    positions.get(vm.id) ?? { x: vm.x, y: vm.y };

  // lb → replica link tubes: only while the pool's lb still exists on canvas.
  const linkTubes: ReplicaLink[] = [];
  for (const vm of spawnedVms) {
    const pool = pools[vm.poolId];
    if (!pool) continue;
    const lb = resourceById.get(pool.lbId);
    if (!lb) continue;
    const slot = slotOf(vm);
    linkTubes.push({ vm, lb, x: slot.x, y: slot.y });
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
        {linkTubes.map(({ vm, lb, x, y }) => (
          <BezierConnectionLine
            key={`replica-link-${vm.id}`}
            source={lb}
            target={{ x, y, type: RESOURCE_TYPES.VirtualMachine }}
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
      {activeVms.map((vm) => {
        const slot = slotOf(vm);
        return (
          <div
            key={vm.id}
            className="absolute z-10 pointer-events-none"
            style={{ left: slot.x, top: slot.y, width: NODE_CARD_WIDTH }}
          >
            <MonitoringDashboardCard
              mode="live"
              asContent
              resource={{
                id: vm.id,
                type: RESOURCE_TYPES.VirtualMachine,
                x: slot.x,
                y: slot.y,
              }}
            />
          </div>
        );
      })}
      {/* Provisioning ghosts */}
      {provisioningVms.map((vm) => {
        const slot = slotOf(vm);
        return (
          <ProvisioningNode key={vm.id} vm={{ ...vm, x: slot.x, y: slot.y }} />
        );
      })}
    </>
  );
});