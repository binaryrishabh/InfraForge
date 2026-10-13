import { memo, useEffect, useState } from "react";
import { toast } from "sonner";
import { useCanvasStore } from "../store/canvasStore";
import { CostBurnTicker } from "@/features/monitoring/components/CostBurnTicker";
import { SpeedControlPanel } from "@/features/monitoring/components/SpeedControlPanel";
import { ConfirmModal } from "@/components/UI/ConfirmModal";
import { teardownDeployment, getRunAction } from "@/api/deployment.api";
import type { RunAction } from "@infraforge/contracts/actions";
import { DeploymentStatus } from "@infraforge/contracts/deployment";
import {
  FLOATING_CHROME_SURFACE,
  FLOATING_CHROME_SHADOW,
} from "@/theme/floatingChrome";

interface LiveTopbarProps {
  deploymentId: string;
  status: string;
}

/* Floating pill — same solid chrome grammar as the design topbar. Status
chip is strictly semantic: teal for live/running/completed, brick for
failed, graphite for torn-down. Tear down owns the brick ghost. */
export const LiveTopbar = memo(function LiveTopbar({ deploymentId, status }: LiveTopbarProps) {
  const currentLayoutName = useCanvasStore((s) => s.currentLayoutName);
  const [showTeardownConfirm, setShowTeardownConfirm] = useState(false);
  const [teardownLoading, setTeardownLoading] = useState(false);
  const [stopAction, setStopAction] = useState<RunAction | null>(null);
  const stopping = !!stopAction && ["requested", "applying", "running"].includes(stopAction.status);
  const stopActionId = stopAction?.id;
  useEffect(() => {
    if (!stopping || !stopActionId) return;
    let active = true;
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void getRunAction(deploymentId, stopActionId).then((action) => {
        if (active) setStopAction(action);
      }).catch(() => {}).finally(() => { busy = false; }); // A lost connection cannot establish completion.
    }, 1000);
    return () => { active = false; clearInterval(timer); };
  }, [deploymentId, stopping, stopActionId]);

  const isLive = status === DeploymentStatus.LIVE && stopAction?.status !== "completed";

  const statusColor =
    status === DeploymentStatus.LIVE ||
    status === DeploymentStatus.COMPLETED ||
    status === DeploymentStatus.RUNNING
      ? "text-[#4FA89B]"
      : status === DeploymentStatus.FAILED
        ? "text-[#C4574A]"
        : status === DeploymentStatus.TORN_DOWN
          ? "text-[#5A5F6B]"
          : "text-[#8B909C]";

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
          <span className="w-px h-5 bg-[#2A2E37] shrink-0" />
          {currentLayoutName && (
            <span className="text-[13px] font-medium text-[#EDEEF0] truncate max-w-40">
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
            className={`px-2 py-0.5 rounded-md border border-[#2A2E37] bg-[#14161A] text-[11px] font-mono shrink-0 ${statusColor}`}
          >
            {stopping ? "Stopping…" : stopAction?.status === "completed" ? "torn-down" : status}
          </span>
          {isLive && (
            <button
              onClick={() => setShowTeardownConfirm(true)}
              disabled={stopping}
              className="h-7 px-3 rounded-lg bg-transparent border border-[#C4574A]/40 text-[12px] font-medium text-[#C4574A] hover:bg-[#C4574A]/10 transition-colors duration-150 shrink-0"
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
              const action = await teardownDeployment(deploymentId);
              setStopAction(action);
              setShowTeardownConfirm(false);
              toast.info(action.status === "completed" ? "Environment torn down" : "Stop requested; waiting for the simulator to capture final state.");
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
