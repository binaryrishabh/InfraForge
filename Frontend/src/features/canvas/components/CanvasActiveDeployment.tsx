import { useCanvasStore } from "../store/canvasStore";
import { DeploymentPipeline } from "@/features/deployment/components/DeploymentPipeline";

export function CanvasActiveDeployment() {
  const activeDeploymentId = useCanvasStore((s) => s.activeDeploymentId);
  const setActiveDeploymentId = useCanvasStore((s) => s.setActiveDeploymentId);
  const setIsDeploying = useCanvasStore((s) => s.setIsDeploying);

  if (!activeDeploymentId) return null;

  return (
    <DeploymentPipeline
      deploymentId={activeDeploymentId}
      onDeploymentPreviewClose={() => {
        setActiveDeploymentId(null);
        setIsDeploying(false);
      }}
      onDeploymentComplete={() => setIsDeploying(false)}
      onDeploymentFailed={() => setIsDeploying(false)}
    />
  );
}