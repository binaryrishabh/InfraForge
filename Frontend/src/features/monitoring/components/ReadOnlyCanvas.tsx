import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { RESOURCE_TYPES } from "@shared/constants/RESOURCE_TYPES.constants";
import { useSimulationStore } from "../store/simulationStore";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
import type { Resource } from "@shared/interface/Resource.interface";
import { BezierConnectionLine } from "@/features/canvas/components/BezierConnectionLine";
import { MonitoringResourceNode } from "./MonitoringResourceNode";
import { ProvisioningNode } from "./ProvisioningNode";
import { useMonitoringViewport } from "../hooks/useMonitoringViewport";
import { MonitoringZoomControls } from "./MonitoringZoomControls";

interface ReadOnlyCanvasProps {
  resources: Resource[];
  connectionLines: ConnectionLine[];
}

export function ReadOnlyCanvas({ resources, connectionLines }: ReadOnlyCanvasProps) {
  const spawnedVms = useSimulationStore((s) => s.spawnedVms);
  const pools = useSimulationStore((s) => s.pools);

  const {
    containerRef,
    viewport,
    glide,
    handlePanStart,
    handlePointerMove,
    handlePointerUp,
    startNodeDrag,
    getNodeOffset,
    fitToNodes,
    zoomIn,
    zoomOut,
  } = useMonitoringViewport();

  // Measure the canvas container height so nodes can decide when their hover HUD
  // would clip below the canvas bottom and flip to the right instead.
  const [containerHeight, setContainerHeight] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.getBoundingClientRect().height);
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Effective position = base position + any user drag offset.
  const effectivePos = (id: string, baseX: number, baseY: number) => {
    const off = getNodeOffset(id);
    return { x: baseX + off.dx, y: baseY + off.dy };
  };

  // All current node positions (base + spawned + dragged) for framing.
  const computeNodePositions = useCallback(() => {
    const positions: { x: number; y: number }[] = [];
    for (const r of resources) {
      const off = getNodeOffset(r.id);
      positions.push({ x: r.x + off.dx, y: r.y + off.dy });
    }
    for (const v of spawnedVms) {
      const off = getNodeOffset(v.id);
      positions.push({ x: v.x + off.dx, y: v.y + off.dy });
    }
    return positions;
  }, [resources, spawnedVms, getNodeOffset]);

  // Re-fit only when the SET of nodes changes (a replica spawns or drains), not on
  // every position/offset change. A provisioning->active flip keeps its position,
  // so the key is unchanged and the view does not jitter.
  const nodeSetKey = useMemo(
    () => [...resources.map((r) => r.id), ...spawnedVms.map((v) => v.id)].sort().join("|"),
    [resources, spawnedVms]
  );

  useEffect(() => {
    fitToNodes(computeNodePositions());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeSetKey]);

  // The ⟲ control now performs a TRUE fit — re-frame every node at its current
  // (possibly dragged) position, gliding smoothly. Replaces the old 100%/origin reset.
  const handleFitView = useCallback(() => {
    fitToNodes(computeNodePositions());
  }, [fitToNodes, computeNodePositions]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-[#0f1117] rounded-lg border border-gray-800 overflow-hidden"
      onPointerDown={handlePanStart}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Transformed "world" layer. pointer-events: none so pan/zoom fall through
          to the container; resource nodes re-enable pointer events. The transform
          transition only applies while `glide` is set (auto-fit), keeping manual
          pan/zoom/drag instant. */}
      <div
        style={{
          transform: `translate(${viewport.translateX}px, ${viewport.translateY}px) scale(${viewport.scale})`,
          transformOrigin: "0 0",
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          transition: glide ? "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)" : "none",
        }}
      >
        <svg
          className="absolute inset-0 pointer-events-none z-10"
          width="100%"
          height="100%"
          style={{ overflow: "visible" }}
        >
          {connectionLines.map((connectionLine) => {
            const source = resources.find((resource) => resource.id === connectionLine.sourceId);
            const target = resources.find((resource) => resource.id === connectionLine.targetId);
            if (!source || !target) return null;
            const sPos = effectivePos(source.id, source.x, source.y);
            const tPos = effectivePos(target.id, target.x, target.y);
            return (
              <BezierConnectionLine
                key={connectionLine.id}
                source={{ ...source, x: sPos.x, y: sPos.y }}
                target={{ ...target, x: tPos.x, y: tPos.y }}
                port={connectionLine.port}
                scale={viewport.scale}
              />
            );
          })}
          {/* Pool links — every spawned/provisioning replica stays visually wired to its Load Balancer */}
          {spawnedVms.map((vm) => {
            const pool = pools[vm.poolId];
            if (!pool) return null;
            const lb = resources.find((resource) => resource.id === pool.lbId);
            if (!lb) return null;
            const lbPos = effectivePos(lb.id, lb.x, lb.y);
            const vmPos = effectivePos(vm.id, vm.x, vm.y);
            return (
              <BezierConnectionLine
                key={`spawn-link-${vm.id}`}
                source={{ ...lb, x: lbPos.x, y: lbPos.y }}
                target={{ x: vmPos.x, y: vmPos.y, type: RESOURCE_TYPES.VirtualMachine }}
                port={80}
                scale={viewport.scale}
              />
            );
          })}
        </svg>
        {resources.map((resource) => {
          const pos = effectivePos(resource.id, resource.x, resource.y);
          return (
            <MonitoringResourceNode
              key={resource.id}
              resource={{ ...resource, x: pos.x, y: pos.y }}
              onNodePointerDown={startNodeDrag}
              scale={viewport.scale}
              translateY={viewport.translateY}
              containerHeight={containerHeight}
            />
          );
        })}
        {spawnedVms
          .filter((v) => v.status === "active")
          .map((v) => {
            const pos = effectivePos(v.id, v.x, v.y);
            return (
              <MonitoringResourceNode
                key={v.id}
                resource={{
                  id: v.id,
                  type: RESOURCE_TYPES.VirtualMachine,
                  x: pos.x,
                  y: pos.y,
                }}
                onNodePointerDown={startNodeDrag}
                scale={viewport.scale}
                translateY={viewport.translateY}
                containerHeight={containerHeight}
              />
            );
          })}
        {spawnedVms
          .filter((v) => v.status === "provisioning")
          .map((v) => {
            const pos = effectivePos(v.id, v.x, v.y);
            return <ProvisioningNode key={v.id} vm={{ ...v, x: pos.x, y: pos.y }} />;
          })}
      </div>
      <MonitoringZoomControls
        scale={viewport.scale}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onReset={handleFitView}
      />
    </div>
  );
}