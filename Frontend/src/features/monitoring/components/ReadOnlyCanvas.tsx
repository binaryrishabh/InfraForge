import { useEffect, useRef, useState } from "react";
import { RESOURCE_TYPES } from "@shared/constants/RESOURCE_TYPES.constants";
import { useSimulationStore } from "../store/simulationStore";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
import type { Resource } from "@shared/interface/Resource.interface";
import { BezierConnectionLine } from "@/features/canvas/components/BezierConnectionLine";
import { MonitoringResourceNode } from "./MonitoringResourceNode";
import { ProvisioningNode } from "./ProvisioningNode";

const NODE_SIZE = 48;
const FIT_PADDING = 64;
const MIN_SCALE = 0.3;
const MAX_SCALE = 1.0;

interface Viewport {
  scale: number;
  translateX: number;
  translateY: number;
}

interface ReadOnlyCanvasProps {
  resources: Resource[];
  connectionLines: ConnectionLine[];
}

export function ReadOnlyCanvas({ resources, connectionLines }: ReadOnlyCanvasProps) {
  const spawnedVms = useSimulationStore((s) => s.spawnedVms);
  const pools = useSimulationStore((s) => s.pools);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>({
    scale: 1,
    translateX: 0,
    translateY: 0,
  });

  // Auto-fit: frame every node (base + active replicas + provisioning ghosts) so
  // nothing ever clips. Runs on mount and whenever the replica set changes. The
  // bounding box only changes when a replica is added/removed, and the setViewport
  // guard below skips no-op updates, so the view glides only on spawn/drain.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const positions: Array<{ x: number; y: number }> = [
      ...resources.map((r) => ({ x: r.x, y: r.y })),
      ...spawnedVms.map((v) => ({ x: v.x, y: v.y })),
    ];
    if (positions.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of positions) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x + NODE_SIZE > maxX) maxX = p.x + NODE_SIZE;
      if (p.y + NODE_SIZE > maxY) maxY = p.y + NODE_SIZE;
    }

    const boxWidth = maxX - minX;
    const boxHeight = maxY - minY;
    if (boxWidth <= 0 || boxHeight <= 0) return;

    const rawScale = Math.min(
      (rect.width - FIT_PADDING * 2) / boxWidth,
      (rect.height - FIT_PADDING * 2) / boxHeight,
    );
    // Never zoom in past 100%, never shrink below 30% — only zoom out to fit.
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, rawScale));

    const translateX = (rect.width - boxWidth * scale) / 2 - minX * scale;
    const translateY = (rect.height - boxHeight * scale) / 2 - minY * scale;

    // Skip no-op updates so a status-only flip (provisioning->active) that leaves
    // the bounding box unchanged does not re-trigger a render or a transition.
    setViewport((prev) => {
      if (
        prev.scale === scale &&
        prev.translateX === translateX &&
        prev.translateY === translateY
      ) {
        return prev;
      }
      return { scale, translateX, translateY };
    });
  }, [spawnedVms, resources]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-[#0f1117] rounded-lg border border-gray-800 overflow-hidden"
    >
      {/* Transformed "world" layer — SVG lines + all nodes transform together. */}
      <div
        style={{
          transform: `translate(${viewport.translateX}px, ${viewport.translateY}px) scale(${viewport.scale})`,
          transformOrigin: "0 0",
          transition: "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
        }}
      >
        <svg
          className="absolute inset-0 pointer-events-none z-10"
          width="100%"
          height="100%"
          style={{ overflow: "visible" }}
        >
          {connectionLines.map((connectionLine) => {
            const source = resources.find(
              (resource) => resource.id === connectionLine.sourceId,
            );
            const target = resources.find(
              (resource) => resource.id === connectionLine.targetId,
            );
            if (!source || !target) return null;
            return (
              <BezierConnectionLine
                key={connectionLine.id}
                source={source}
                target={target}
                port={connectionLine.port}
              />
            );
          })}
          {/* Pool links — every spawned/provisioning replica stays visually wired to its Load Balancer */}
          {spawnedVms.map((vm) => {
            const pool = pools[vm.poolId];
            if (!pool) return null;
            const lb = resources.find((resource) => resource.id === pool.lbId);
            if (!lb) return null;
            return (
              <BezierConnectionLine
                key={`spawn-link-${vm.id}`}
                source={lb}
                target={{ x: vm.x, y: vm.y, type: RESOURCE_TYPES.VirtualMachine }}
                port={80}
              />
            );
          })}
        </svg>
        {resources.map((resource) => (
          <MonitoringResourceNode key={resource.id} resource={resource} />
        ))}
        {spawnedVms
          .filter((v) => v.status === "active")
          .map((v) => (
            <MonitoringResourceNode
              key={v.id}
              resource={{
                id: v.id,
                type: RESOURCE_TYPES.VirtualMachine,
                x: v.x,
                y: v.y,
              }}
            />
          ))}
        {spawnedVms
          .filter((v) => v.status === "provisioning")
          .map((v) => (
            <ProvisioningNode key={v.id} vm={v} />
          ))}
      </div>
    </div>
  );
}