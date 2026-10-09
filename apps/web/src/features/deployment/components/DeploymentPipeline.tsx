import { useEffect } from "react";
import { X } from "lucide-react";
import { DEPLOYMENT_STAGES_NAMES } from "@infraforge/contracts/deployment";
import { DeploymentStatus } from "@infraforge/contracts/deployment";
import type { DeploymentTimeline } from "@infraforge/contracts/deployment";

interface DeploymentPipelineProps {
  deploymentId: string;
  status: string;
  completedStages: string[];
  timeline: Array<DeploymentTimeline>;
  closable: boolean;
  onClose: () => void;
  onDeploymentComplete: () => void;
  onDeploymentFailed: () => void;
}

/* Status word tones — teal while working/live, brick on failure, graphite
for anything quiet. Gates use the same semantic set. */
const STATUS_TEXT: Record<string, string> = {
  [DeploymentStatus.RUNNING]: "text-[#4FA89B]",
  [DeploymentStatus.COMPLETED]: "text-[#4FA89B]",
  [DeploymentStatus.LIVE]: "text-[#4FA89B]",
  [DeploymentStatus.FAILED]: "text-[#C4574A]",
};

export function DeploymentPipeline({
  // deploymentId remains part of the prop contract for callers, but the
  // presentational render does not need it — so it is not destructured.
  status,
  completedStages,
  timeline,
  closable,
  onClose,
  onDeploymentComplete,
  onDeploymentFailed,
}: DeploymentPipelineProps) {
  useEffect(() => {
    if (status === DeploymentStatus.COMPLETED || status === DeploymentStatus.LIVE) {
      onDeploymentComplete();
    }
    if (status === DeploymentStatus.FAILED) {
      onDeploymentFailed();
    }
  }, [status, onDeploymentComplete, onDeploymentFailed]);

  const statusTone = STATUS_TEXT[status] ?? "text-[#5A5F6B]";

  return (
    // Centered popup: veil blocks the canvas while provisioning; the panel
    // uses the exact Modal grammar (surface, border, radius, shadow).
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      {/* Dim veil — no click-to-close: an accidental click must never
          orphan a running deployment. Closing is the X button only. */}
      <div className="absolute inset-0 bg-[#0A0B0D]/75" />
      <div className="infraforge-drop-in relative w-full max-w-lg bg-[#1C1F26] border border-[#2A2E37] rounded-[14px] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.55),0_8px_20px_rgba(0,0,0,0.35)]">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <h3 className="text-[14px] font-semibold text-[#EDEEF0] tracking-[-0.01em]">
              Deployment
            </h3>
            <span className={`text-[11px] font-mono uppercase tracking-wider ${statusTone}`}>
              {status}
            </span>
          </div>
          {closable && (
            <button
              type="button"
              onClick={onClose}
              title="Close pipeline"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#5A5F6B] hover:text-[#EDEEF0] hover:bg-[#2A2E37]/60 transition-colors duration-150 cursor-pointer"
            >
              <X size={14} strokeWidth={2} />
            </button>
          )}
        </div>
        {/* Three real gates — bar + caps label per gate */}
        <div className="flex gap-1.5 mb-4">
          {DEPLOYMENT_STAGES_NAMES.map((stageName) => {
            const isCompleted = completedStages.includes(stageName);
            const isCurrent =
              completedStages.length === DEPLOYMENT_STAGES_NAMES.indexOf(stageName) &&
              status === DeploymentStatus.RUNNING;
            const isFailed =
              status === DeploymentStatus.FAILED &&
              !isCompleted &&
              completedStages.length === DEPLOYMENT_STAGES_NAMES.indexOf(stageName);
            return (
              <div key={stageName} className="flex-1">
                <div
                  className={`h-1.5 rounded-full transition-colors duration-300 ${
                    isCompleted
                      ? "bg-[#4FA89B]"
                      : isFailed
                        ? "bg-[#C4574A]"
                        : isCurrent
                          ? "bg-[#4FA89B] animate-pulse"
                          : "bg-[#2A2E37]"
                  }`}
                />
                <p className="text-[9px] font-mono uppercase tracking-wider text-[#5A5F6B] mt-1.5 text-center truncate">
                  {stageName}
                </p>
              </div>
            );
          })}
        </div>
        {/* Timeline — inset well with the shared thin scrollbar */}
        <div className="infraforge-scroll max-h-44 overflow-y-auto rounded-lg bg-[#14161A] border border-[#2A2E37] p-3 space-y-1">
          {timeline.length === 0 ? (
            <p className="text-[10px] font-mono text-[#5A5F6B]">
              Waiting for pipeline events…
            </p>
          ) : (
            timeline.map((entry, i) => (
              <div key={i} className="flex gap-2 text-[10px] font-mono leading-relaxed">
                <span className="text-[#5A5F6B] shrink-0">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                <span className="text-[#8B909C] shrink-0 w-32 truncate">
                  {entry.event}
                </span>
                <span className="text-[#8B909C] min-w-0">{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}