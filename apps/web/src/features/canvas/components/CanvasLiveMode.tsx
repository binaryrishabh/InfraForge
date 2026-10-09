import { useEffect } from "react";
import { useDeploymentSocket } from "@/features/deployment/hooks/useDeploymentSocket";
import { useCanvasStore } from "../store/canvasStore";
import { useLiveTopologySync } from "../hooks/useLiveTopologySync";
import { DeploymentStatus } from "@infraforge/contracts/deployment";
import { CanvasSurface } from "./CanvasSurface";
import { LiveTopbar } from "./LiveTopbar";
import { LiveOperatorDock } from "./LiveOperatorDock";
import { LiveWaitingState } from "./LiveWaitingState";
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
  const isLive = status === DeploymentStatus.LIVE;
  const isConnectionError = status === "Web Socket connection error";

  // Stream committed canvas edits to the running simulator while LIVE.
  useLiveTopologySync(isLive, deploymentId);

  // Track liveness so cards flip between design and live telemetry — AND
  // release the deploy lock the moment the environment goes LIVE.
  useEffect(() => {
    setLiveMode(isLive);
    if (isLive) setIsDeploying(false);
    return () => setLiveMode(false);
  }, [isLive, setLiveMode, setIsDeploying]);

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
    <>
      {/* Exact design-page composition: ONE full-bleed surface, with the
          mode-specific chrome floated above it as children. */}
      <CanvasSurface className="h-screen bg-[#14161A] text-white">
        <LiveTopbar deploymentId={deploymentId} status={status} />
        <div className="absolute top-3 right-4 z-40">
          <ShellMenu />
        </div>
        {!isLive && (
          <LiveWaitingState
            status={status}
            isConnectionError={isConnectionError}
          />
        )}
        {isLive && (
          <LiveOperatorDock
            deploymentId={deploymentId}
            status={status}
            resources={resources}
            deployment={deployment}
          />
        )}
      </CanvasSurface>
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
    </>
  );
}
