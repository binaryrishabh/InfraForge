import { useEffect } from "react";
import { useDeploymentSocket } from "@/features/deployment/hooks/useDeploymentSocket";
import { useCanvasStore } from "../store/canvasStore";
import { DeploymentStatus } from "@shared/enum/DeploymentStatus.enum";
import { ReadOnlyCanvas } from "@/features/monitoring/components/ReadOnlyCanvas";
import { LiveTopbar } from "./LiveTopbar";
import { LiveControlRail } from "./LiveControlRail";
import { DeploymentPipeline } from "@/features/deployment/components/DeploymentPipeline";

interface CanvasLiveModeProps {
  deploymentId: string;
}

export function CanvasLiveMode({ deploymentId }: CanvasLiveModeProps) {
  const { status, completedStages, timeline } = useDeploymentSocket(deploymentId);
  const resources = useCanvasStore((s) => s.resources);
  const connectionLines = useCanvasStore((s) => s.connectionLines);
  const setActiveDeploymentId = useCanvasStore((s) => s.setActiveDeploymentId);
  const setIsDeploying = useCanvasStore((s) => s.setIsDeploying);

  const isLive = status === DeploymentStatus.LIVE;

  useEffect(() => {
    if (status === DeploymentStatus.TORN_DOWN || status === DeploymentStatus.FAILED) {
      setActiveDeploymentId(null);
      setIsDeploying(false);
    }
  }, [status, setActiveDeploymentId, setIsDeploying]);

  const showPipeline =
    status === DeploymentStatus.PENDING ||
    status === DeploymentStatus.RUNNING ||
    status === DeploymentStatus.COMPLETED;

  return (
    <div className="flex flex-col h-screen bg-[#0f1117] text-white">
      <LiveTopbar deploymentId={deploymentId} status={status} />
      
      <div className="flex-1 flex overflow-hidden relative">
        {isLive ? (
          <>
            <div className="flex-1 p-4">
              <ReadOnlyCanvas resources={resources} connectionLines={connectionLines} />
            </div>
            <LiveControlRail
              deploymentId={deploymentId}
              status={status}
              resources={resources}
            />
          </>
        ) : (
          <div
            className="flex-1 flex items-center justify-center"
            style={{
              backgroundImage: `radial-gradient(circle, #1e293b 1px, transparent 1px)`,
              backgroundSize: `24px 24px`,
            }}
          >
            <span className="text-sm font-mono text-[#677185]">provisioning…</span>
          </div>
        )}
      </div>

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