import type { DeploymentTimeline } from "@shared/types/DeploymentTimeline.types";

interface TimelinePanelProps {
  timeline: DeploymentTimeline[];
}

export function TimelinePanel({ timeline }: TimelinePanelProps) {
  return (
    <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
      <h3 className="text-xs font-semibold text-gray-400 mb-2">Timeline</h3>
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {timeline.map((entry, i) => (
          <div key={i} className="text-xs flex gap-2">
            <span className="text-gray-600 shrink-0">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
            <span className="text-gray-400">{entry.event}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
