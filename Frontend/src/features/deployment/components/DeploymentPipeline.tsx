import { useEffect } from "react";
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

export function DeploymentPipeline({
  deploymentId,
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

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-950 border-t border-gray-800 p-4 z-40">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">
          Deployment:{" "}
          <span
            className={`${
              status === DeploymentStatus.RUNNING
                ? "text-blue-400"
                : status === DeploymentStatus.COMPLETED
                ? "text-green-400"
                : status === DeploymentStatus.LIVE
                ? "text-emerald-400"
                : status === DeploymentStatus.FAILED
                ? "text-red-400"
                : "text-gray-400"
            }`}
          >
            {status}
          </span>
        </h3>
        {closable && (
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xs cursor-pointer">
            X Close
          </button>
        )}
      </div>
      
      {/* Pipeline bars */}
      <div className="flex gap-1.5 mb-3">
        {DEPLOYMENT_STAGES_NAMES.map((stageName) => {
          const isCompleted = completedStages.includes(stageName);
          const isCurrent =
            completedStages.length === DEPLOYMENT_STAGES_NAMES.indexOf(stageName) && status === DeploymentStatus.RUNNING;
          const isFailed =
            status === DeploymentStatus.FAILED && !isCompleted && completedStages.length === DEPLOYMENT_STAGES_NAMES.indexOf(stageName);
          return (
            <div key={stageName} className="flex-1">
              <div
                className={`h-2 rounded-full transition-colors duration-300 ${
                  isCompleted
                    ? "bg-green-500"
                    : isFailed
                    ? "bg-red-500"
                    : isCurrent
                    ? "bg-blue-500 animate-pulse"
                    : "bg-gray-800"
                }`}
              />
              <p className="text-[10px] text-gray-500 mt-1 text-center truncate">{stageName}</p>
            </div>
          );
        })}
      </div>
      
      {/* Timeline */}
      <div className="max-h-24 overflow-y-auto text-xs text-gray-400 space-y-0.5">
        {timeline.map((entry, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-gray-600 shrink-0 w-20">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
            <span className="text-gray-500 shrink-0 w-35">{entry.event}</span>
            <span>{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}