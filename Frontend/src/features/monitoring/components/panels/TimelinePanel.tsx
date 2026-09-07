import type { DeploymentTimeline } from "@shared/interface/DeploymentTimeline.interface";
import { PANEL_SHELL_CLASS } from "@/theme/resourceCategoryHues";

interface TimelinePanelProps {
  timeline: DeploymentTimeline[];
}

export function TimelinePanel({ timeline }: TimelinePanelProps) {
  return (
    <div className={PANEL_SHELL_CLASS}>
      <h3 className="text-[10px] uppercase tracking-wider text-[#677185] font-semibold mb-2">Timeline</h3>
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