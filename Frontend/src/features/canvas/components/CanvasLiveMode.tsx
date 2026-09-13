import { useEffect } from "react";
import { DndContext } from "@dnd-kit/core";
import { useDeploymentSocket } from "@/features/deployment/hooks/useDeploymentSocket";
import { useCanvasStore } from "../store/canvasStore";
import { useCanvasDragDrop } from "../hooks/useCanvasDragDrop";
import { useLiveTopologySync } from "../hooks/useLiveTopologySync";
import { canvasGridStyle } from "../utils/canvasGridStyle";
import { DeploymentStatus } from "@shared/enum/DeploymentStatus.enum";
import { CanvasBoard } from "./CanvasBoard";
import { ResourcePaletteDrawer } from "./ResourcePaletteDrawer";
import { ZoomControls } from "./ZoomControls";
import { HistoryControls } from "./HistoryControls";
import { GestureHintPill } from "./GestureHintPill";
import { CanvasConfigPanelWrapper } from "./CanvasConfigPanelWrapper";
import { CanvasModals } from "./CanvasModals";
import { CanvasDragLayer } from "./CanvasDragLayer";
import { LiveTopbar } from "./LiveTopbar";
import { LiveOperatorDock } from "./LiveOperatorDock";
import { DeploymentPipeline } from "@/features/deployment/components/DeploymentPipeline";
import { ShellMenu } from "@/components/shell/ShellMenu";

interface CanvasLiveModeProps {
  deploymentId: string;
}

export function CanvasLiveMode({ deploymentId }: CanvasLiveModeProps) {
  const { deployment, status, completedStages, timeline } =
    useDeploymentSocket(deploymentId);
  const resources = useCanvasStore((s) => s.resources);
  const setActiveDeploymentId = useCanvasStore((s) => s.setActiveDeploymentId);
  const setIsDeploying = useCanvasStore((s) => s.setIsDeploying);
  const setLiveMode = useCanvasStore((s) => s.setLiveMode);
  const dragDrop = useCanvasDragDrop();

  const isLive = status === DeploymentStatus.LIVE;
  const isConnectionError = status === "Web Socket connection error";

  // Stream committed canvas edits to the running simulator while LIVE.
  useLiveTopologySync(isLive);

  // Track liveness so cards flip between design and live telemetry.
  useEffect(() => {
    setLiveMode(isLive);
    return () => setLiveMode(false);
  }, [isLive, setLiveMode]);

  useEffect(() => {
    if (status === DeploymentStatus.TORN_DOWN) {
      setActiveDeploymentId(null);
      setIsDeploying(false);
    }
  }, [status, setActiveDeploymentId, setIsDeploying]);

  const showPipeline =
    status === DeploymentStatus.PENDING ||
    status === DeploymentStatus.RUNNING ||
    status === DeploymentStatus.COMPLETED ||
    status === DeploymentStatus.FAILED;

  return (
    <DndContext
      sensors={dragDrop.sensors}
      collisionDetection={dragDrop.collisionDetection}
      measuring={dragDrop.measuring}
      onDragStart={dragDrop.onDragStart}
      onDragEnd={dragDrop.onDragEnd}
    >
      {/* Full-bleed live surface; every chrome piece floats above it. */}
      <div className="relative h-screen bg-[#0f1117] text-white overflow-hidden">
        {isLive ? (
          <div className="absolute inset-0 flex overflow-hidden">
            <CanvasBoard />
            <ZoomControls />
            <HistoryControls />
            <GestureHintPill />
            <ResourcePaletteDrawer />
          </div>
        ) : (
          // Non-live states keep the graph paper but speak in panel cards,
          // never bare mono spans on the void.
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={canvasGridStyle(1, 0, 0)}
          >
            <div className="bg-[#171C27] border border-[#273042] rounded-[14px] px-6 py-5 shadow-[0_24px_60px_rgba(0,0,0,0.55)] text-center max-w-sm">
              {isConnectionError ? (
                <>
                  <p className="text-[14px] font-semibold text-[#F5A524] tracking-[-0.01em]">
                    Connection lost
                  </p>
                  <p className="text-[12px] text-[#677185] mt-1">
                    reconnecting to the simulation…
                  </p>
                </>
              ) : status === DeploymentStatus.FAILED ? (
                <>
                  <p className="text-[14px] font-semibold text-[#F0564A] tracking-[-0.01em]">
                    Deployment failed
                  </p>
                  <p className="text-[12px] text-[#677185] mt-1">
                    the deployment popup carries the failure timeline
                  </p>
                </>
              ) : (
                <>
                  <span className="mx-auto w-4 h-4 border-2 border-[#677185]/30 border-t-[#AAB4C5] rounded-full animate-spin block" />
                  <p className="text-[14px] font-semibold text-[#AAB4C5] tracking-[-0.01em] mt-3">
                    Provisioning environment…
                  </p>
                  <p className="text-[12px] text-[#677185] mt-1">
                    the pipeline gates are running
                  </p>
                </>
              )}
            </div>
          </div>
        )}
        <LiveTopbar deploymentId={deploymentId} status={status} />
        {/* Hamburger shell menu rides the top-right, exactly like design. */}
        <div className="absolute top-3 right-4 z-40">
          <ShellMenu />
        </div>
        {isLive && (
          <LiveOperatorDock
            deploymentId={deploymentId}
            status={status}
            resources={resources}
            deployment={deployment}
          />
        )}
        <CanvasConfigPanelWrapper />
        <CanvasModals />
        <CanvasDragLayer />
        {showPipeline && (
          <DeploymentPipeline
            deploymentId={deploymentId}
            status={status}
            completedStages={completedStages}
            timeline={timeline}
            closable={!isLive}
            onClose={() => {
              setActiveDeploymentId(null);
              setIsDeploying(false);
            }}
            onDeploymentComplete={() => setIsDeploying(false)}
            onDeploymentFailed={() => setIsDeploying(false)}
          />
        )}
      </div>
    </DndContext>
  );
}