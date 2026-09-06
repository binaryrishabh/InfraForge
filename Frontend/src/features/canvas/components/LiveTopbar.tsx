import { memo, useState } from "react";
import { toast } from "sonner";
import { useCanvasStore } from "../store/canvasStore";
import { CostBurnTicker } from "@/features/monitoring/components/CostBurnTicker";
import { SpeedControlPanel } from "@/features/monitoring/components/SpeedControlPanel";
import { ConfirmModal } from "@/components/UI/ConfirmModal";
import { teardownDeployment } from "@/api/deployment.api";
import { DeploymentStatus } from "@shared/enum/DeploymentStatus.enum";

interface LiveTopbarProps {
  deploymentId: string;
  status: string;
}

export const LiveTopbar = memo(function LiveTopbar({ deploymentId, status }: LiveTopbarProps) {
  const currentLayoutName = useCanvasStore((s) => s.currentLayoutName);
  const [showTeardownConfirm, setShowTeardownConfirm] = useState(false);
  const [teardownLoading, setTeardownLoading] = useState(false);

  const statusColor =
    status === DeploymentStatus.COMPLETED
      ? "text-green-400"
      : status === DeploymentStatus.LIVE
      ? "text-emerald-400"
      : status === DeploymentStatus.FAILED
      ? "text-red-400"
      : status === DeploymentStatus.RUNNING
      ? "text-blue-400"
      : status === DeploymentStatus.TORN_DOWN
      ? "text-gray-500"
      : "text-gray-400";

  return (
    <>
      <div className="h-12 bg-gray-950 border-b border-gray-800 flex items-center justify-between px-4 shrink-0">
        <span className="text-sm font-semibold tracking-wide text-gray-200 select-none flex items-center gap-2">
          ⚡ InfraForge
          {currentLayoutName && (
            <span className="text-blue-400 ml-2">{currentLayoutName}</span>
          )}
        </span>
        <div className="flex items-center gap-3">
          <CostBurnTicker />
          <SpeedControlPanel deploymentId={deploymentId} status={status} />
          <span className={`text-xs ${statusColor}`}>{status}</span>
          {status === DeploymentStatus.LIVE && (
            <button
              onClick={() => setShowTeardownConfirm(true)}
              className="h-7 px-3 rounded-lg bg-[rgba(240,86,74,0.10)] border border-[rgba(240,86,74,0.35)] text-[12px] font-medium text-[#F0564A] hover:bg-[rgba(240,86,74,0.18)] transition-colors duration-150"
            >
              Tear down
            </button>
          )}
        </div>
      </div>
      
      {showTeardownConfirm && (
        <ConfirmModal
          open={true}
          onOpenChange={(open) => {
            if (!open && !teardownLoading) setShowTeardownConfirm(false);
          }}
          title="Tear down environment?"
          description="This stops the simulation permanently for this deployment. The canvas snapshot and deployment history remain."
          consequences={[
            {
              icon: "danger",
              text: "The live simulation will stop and cannot be resumed.",
            },
          ]}
          confirmLabel="Tear down"
          intent="danger"
          loading={teardownLoading}
          onConfirm={async () => {
            setTeardownLoading(true);
            try {
              await teardownDeployment(deploymentId);
              setShowTeardownConfirm(false);
              toast.success("Environment torn down");
            } catch {
              toast.error("Failed to tear down");
            } finally {
              setTeardownLoading(false);
            }
          }}
        />
      )}
    </>
  );
});