import { memo } from "react";
import { useCanvasStore } from "../store/canvasStore";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import {
  CATEGORY_OF_RESOURCE_TYPE,
  type ResourceCategory,
} from "@/theme/resourceCategoryHues";
import { CONTROL_PILL_SURFACE } from "../utils/controlPillClass";

/* Display order + caps abbreviations for the category counts. */
const CATEGORY_ORDER: Array<{ category: ResourceCategory; label: string }> = [
  { category: "entry-edge", label: "ENTRY" },
  { category: "traffic-security", label: "TRAFFIC" },
  { category: "compute", label: "COMPUTE" },
  { category: "data", label: "DATA" },
  { category: "messaging", label: "MSG" },
  { category: "observability", label: "OBS" },
];

/* Persistent, quiet composition readout. Subscriptions are primitive-only:
a counts key (changes only when the category mix changes), link count,
liveMode, and simulatedSeconds ONLY while live (selector returns 0 otherwise
so 1Hz snapshots never re-render this pill in design mode). */
export const CanvasStatusPill = memo(function CanvasStatusPill() {
  const linkCount = useCanvasStore((s) => s.connectionLines.length);
  const liveMode = useCanvasStore((s) => s.liveMode);
  const simulatedSeconds = useSimulationStore((s) =>
    liveMode ? s.simulatedSeconds : 0,
  );
  const compositionKey = useCanvasStore((s) => {
    const counts: Partial<Record<ResourceCategory, number>> = {};
    for (const resource of s.resources) {
      const category = CATEGORY_OF_RESOURCE_TYPE[resource.type];
      counts[category] = (counts[category] ?? 0) + 1;
    }
    return CATEGORY_ORDER.map((entry) => counts[entry.category] ?? 0).join(":");
  });

  const counts = compositionKey.split(":").map(Number);
  const nodeCount = counts.reduce((total, value) => total + value, 0);

  return (
    <div
      className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-30 ${CONTROL_PILL_SURFACE}`}
    >
      <span className="text-[10px] font-mono uppercase tracking-wider text-[#677185] whitespace-nowrap">
        <span className="text-[#AAB4C5] tabular-nums">{nodeCount}</span> nodes ·{" "}
        <span className="text-[#AAB4C5] tabular-nums">{linkCount}</span> links
        {CATEGORY_ORDER.map((entry, index) =>
          counts[index] ? (
            <span key={entry.category}>
              {" · "}
              {entry.label}{" "}
              <span className="text-[#AAB4C5] tabular-nums">
                {counts[index]}
              </span>
            </span>
          ) : null,
        )}
        {liveMode && (
          <span>
            {" · "}t+
            <span className="text-[#AAB4C5] tabular-nums">
              {simulatedSeconds}
            </span>
            s
          </span>
        )}
      </span>
    </div>
  );
});