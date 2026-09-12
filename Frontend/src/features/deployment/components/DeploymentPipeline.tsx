import { useEffect } from "react";
import { X } from "lucide-react";
import { DEPLOYMENT_STAGES_NAMES } from "@shared/constants/DEPLOYMENT_STAGES_NAMES.constants";
import { DeploymentStatus } from "@shared/enum/DeploymentStatus.enum";
import type { DeploymentTimeline } from "@shared/interface/DeploymentTimeline.interface";

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

/* Status word tones — accent while working, emerald on success, danger on
failure, quiet graphite for anything else (pending / torn-down). */
const STATUS_TEXT: Record<string, string> = {
  [DeploymentStatus.RUNNING]: "text-[#5B8CFF]",
  [DeploymentStatus.COMPLETED]: "text-emerald-400",
  [DeploymentStatus.LIVE]: "text-emerald-400",
  [DeploymentStatus.FAILED]: "text-[#F0564A]",
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

  const statusTone = STATUS_TEXT[status] ?? "text-[#677185]";

  return (
    // Centered popup: veil blocks the canvas while provisioning; the panel
    // uses the exact Modal grammar (surface, border, radius, shadow).
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      {/* Dim veil — no click-to-close: an accidental click must never
          orphan a running deployment. Closing is the X button only. */}
      <div className="absolute inset-0 bg-[#05070C]/75" />
      <div className="infraforge-drop-in relative w-full max-w-lg bg-[#171C27] border border-[#273042] rounded-[14px] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.55),0_8px_20px_rgba(0,0,0,0.35)]">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <h3 className="text-[14px] font-semibold text-[#EDF1F7] tracking-[-0.01em]">
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
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#677185] hover:text-[#EDF1F7] hover:bg-[#232B3B] transition-colors duration-150 cursor-pointer"
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
                      ? "bg-emerald-500"
                      : isFailed
                        ? "bg-[#F0564A]"
                        : isCurrent
                          ? "bg-[#5B8CFF] animate-pulse"
                          : "bg-[#1F2633]"
                  }`}
                />
                <p className="text-[9px] font-mono uppercase tracking-wider text-[#677185] mt-1.5 text-center truncate">
                  {stageName}
                </p>
              </div>
            );
          })}
        </div>
        {/* Timeline — inset well with the shared thin scrollbar */}
        <div className="infraforge-scroll max-h-44 overflow-y-auto rounded-lg bg-[#0B0E14] border border-[#1F2633] p-3 space-y-1">
          {timeline.length === 0 ? (
            <p className="text-[10px] font-mono text-[#677185]">
              Waiting for pipeline events…
            </p>
          ) : (
            timeline.map((entry, i) => (
              <div key={i} className="flex gap-2 text-[10px] font-mono leading-relaxed">
                <span className="text-[#677185] shrink-0">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                <span className="text-[#AAB4C5] shrink-0 w-32 truncate">
                  {entry.event}
                </span>
                <span className="text-[#AAB4C5] min-w-0">{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}