import { memo, useEffect } from "react";
import { useCanvasStore } from "../store/canvasStore";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { BezierConnectionLine } from "./BezierConnectionLine";
import { ReplicaCard } from "./ReplicaCard";
import { ProvisioningNode } from "@/features/monitoring/components/ProvisioningNode";
import { findFreeReplicaSlot } from "../utils/replicaSlotLayout";
import {
  NODE_CARD_WIDTH,
  NODE_CARD_HEIGHT,
} from "@/features/monitoring/components/MonitoringDashboardCard";
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
tubes, draggable replica cards, and provisioning ghosts. Each replica gets a
tidy free slot ONCE, at first sight, frozen in canvasStore.replicaPositions —
so dragging a base VM never drags its ASG along, replicas occupy space like
real nodes, and drains simply prune their positions. Re-renders stay driven
by primitive keys only. */
export const SpawnedReplicaLayer = memo(function SpawnedReplicaLayer() {
  const liveMode = useCanvasStore((s) => s.liveMode);
  const scale = useCanvasStore((s) => s.scale);
  const resources = useCanvasStore((s) => s.resources);
  const replicaPositions = useCanvasStore((s) => s.replicaPositions);
  // Boolean selectors: stable across 1Hz snapshots, no extra re-renders.
  const simulationRunning = useSimulationStore(
    (s) => s.simulatedSeconds > 0 && s.speed > 0,
  );
  // Subscription-only primitive key: id:status:x:y:poolId per replica.
  const replicaKey = useSimulationStore((s) =>
    s.spawnedVms
      .map((v) => `${v.id}:${v.status}:${v.x}:${v.y}:${v.poolId}`)
      .join("|"),
  );

  // Freeze a slot for every replica the first time we see it; prune the
  // positions of drained replicas; wipe everything when we leave LIVE.
  useEffect(() => {
    const store = useCanvasStore.getState();
    if (!liveMode) {
      store.clearReplicaPositions();
      return;
    }
    const { spawnedVms } = useSimulationStore.getState();
    store.pruneReplicaPositions(spawnedVms.map((v) => v.id));
    const taken = [
      ...store.resources.map((r) => ({ x: r.x, y: r.y })),
      ...Object.values(store.replicaPositions).map((p) => ({ x: p.x, y: p.y })),
    ];
    for (const vm of spawnedVms) {
      if (store.replicaPositions[vm.id]) continue;
      const slot = findFreeReplicaSlot(vm.id, vm.x, vm.y, taken);
      taken.push(slot);
      store.setReplicaPosition(vm.id, slot.x, slot.y);
    }
  }, [replicaKey, liveMode]);

  if (!liveMode) return null;

  const { spawnedVms, pools } = useSimulationStore.getState();
  const resourceById = new Map(resources.map((r) => [r.id, r]));
  const posOf = (vm: SpawnedVmInfo) =>
    replicaPositions[vm.id] ?? { x: vm.x, y: vm.y };

  // lb → replica link tubes: only while the pool's lb still exists on canvas.
  const linkTubes: ReplicaLink[] = [];
  for (const vm of spawnedVms) {
    const pool = pools[vm.poolId];
    if (!pool) continue;
    const lb = resourceById.get(pool.lbId);
    if (!lb) continue;
    const pos = posOf(vm);
    linkTubes.push({ vm, lb, x: pos.x, y: pos.y });
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
      {/* Active replica cards: real draggable canvas nodes */}
      {activeVms.map((vm) => {
        const pos = posOf(vm);
        return (
          <ReplicaCard key={vm.id} replicaId={vm.id} x={pos.x} y={pos.y} />
        );
      })}
      {/* Provisioning ghosts */}
      {provisioningVms.map((vm) => {
        const pos = posOf(vm);
        return (
          <ProvisioningNode key={vm.id} vm={{ ...vm, x: pos.x, y: pos.y }} />
        );
      })}
    </>
  );
});