import { memo, useState } from "react";
import { toast } from "sonner";
import { useCanvasStore } from "../store/canvasStore";
import { CostBurnTicker } from "@/features/monitoring/components/CostBurnTicker";
import { SpeedControlPanel } from "@/features/monitoring/components/SpeedControlPanel";
import { ConfirmModal } from "@/components/UI/ConfirmModal";
import { teardownDeployment } from "@/api/deployment.api";
import { DeploymentStatus } from "@shared/enum/DeploymentStatus.enum";
import {
  FLOATING_CHROME_SURFACE,
  FLOATING_CHROME_SHADOW,
} from "@/theme/floatingChrome";

interface LiveTopbarProps {
  deploymentId: string;
  status: string;
}

/* Floating pill — the live surface speaks the exact same chrome grammar as
the design canvas topbar: blurred floating surface, favicon brand, live
readouts only while LIVE, on-token status chip. */
export const LiveTopbar = memo(function LiveTopbar({ deploymentId, status }: LiveTopbarProps) {
  const currentLayoutName = useCanvasStore((s) => s.currentLayoutName);
  const [showTeardownConfirm, setShowTeardownConfirm] = useState(false);
  const [teardownLoading, setTeardownLoading] = useState(false);

  const isLive = status === DeploymentStatus.LIVE;

  // Fully on-token status tones — no legacy gray/blue classes.
  const statusColor =
    status === DeploymentStatus.LIVE || status === DeploymentStatus.COMPLETED
      ? "text-emerald-400"
      : status === DeploymentStatus.RUNNING
        ? "text-[#5B8CFF]"
        : status === DeploymentStatus.FAILED
          ? "text-[#F0564A]"
          : status === DeploymentStatus.TORN_DOWN
            ? "text-[#677185]"
            : "text-[#AAB4C5]";

  return (
    <>
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
        <div className={`pointer-events-auto h-12 ${FLOATING_CHROME_SURFACE} ${FLOATING_CHROME_SHADOW} flex items-center gap-3 px-3 select-none max-w-[calc(100vw-7rem)]`}>
          <img
            src="/favicon.png"
            alt="InfraForge"
            className="h-6 w-6 shrink-0"
            draggable={false}
          />
          <span className="w-px h-5 bg-[#273042] shrink-0" />
          {currentLayoutName && (
            <span className="text-[13px] font-medium text-[#EDF1F7] truncate max-w-40">
              {currentLayoutName}
            </span>
          )}
          {isLive && (
            <>
              <CostBurnTicker />
              <SpeedControlPanel deploymentId={deploymentId} status={status} />
            </>
          )}
          <span
            className={`px-2 py-0.5 rounded-md border border-[#273042] bg-[#0B0E14] text-[11px] font-mono shrink-0 ${statusColor}`}
          >
            {status}
          </span>
          {isLive && (
            <button
              onClick={() => setShowTeardownConfirm(true)}
              className="h-7 px-3 rounded-lg bg-[rgba(240,86,74,0.10)] border border-[rgba(240,86,74,0.35)] text-[12px] font-medium text-[#F0564A] hover:bg-[rgba(240,86,74,0.18)] transition-colors duration-150 shrink-0"
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