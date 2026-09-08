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
import { CanvasConfigPanelWrapper } from "./CanvasConfigPanelWrapper";
import { CanvasModals } from "./CanvasModals";
import { CanvasDragLayer } from "./CanvasDragLayer";
import { LiveTopbar } from "./LiveTopbar";
import { LiveOperatorDock } from "./LiveOperatorDock";
import { DeploymentPipeline } from "@/features/deployment/components/DeploymentPipeline";

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
    <div className="flex flex-col h-screen bg-[#0f1117] text-white">
      <LiveTopbar deploymentId={deploymentId} status={status} />
      {isLive ? (
        <DndContext
          sensors={dragDrop.sensors}
          onDragStart={dragDrop.onDragStart}
          onDragEnd={dragDrop.onDragEnd}
        >
          <div className="flex-1 flex overflow-hidden relative">
            <CanvasBoard />
            <ZoomControls />
            <HistoryControls />
            <ResourcePaletteDrawer />
          </div>
          <CanvasConfigPanelWrapper />
          <CanvasModals />
          <CanvasDragLayer />
        </DndContext>
      ) : (
        <div className="flex-1 flex overflow-hidden relative">
          <div
            className="flex-1 flex items-center justify-center"
            style={canvasGridStyle(1, 0, 0)}
          >
            {isConnectionError ? (
              <span className="text-sm font-mono text-[#F5A524]">
                connection lost — reconnecting…
              </span>
            ) : status === DeploymentStatus.FAILED ? (
              <span className="text-sm font-mono text-[#F0564A]">
                deployment failed — read the timeline below
              </span>
            ) : (
              <span className="text-sm font-mono text-[#677185]">provisioning…</span>
            )}
          </div>
        </div>
      )}
      {isLive && (
        <LiveOperatorDock
          deploymentId={deploymentId}
          status={status}
          resources={resources}
          deployment={deployment}
        />
      )}
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
  );
}