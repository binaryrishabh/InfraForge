import { memo } from "react";
import { useCanvasStore } from "../store/canvasStore";
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

/* Design-only composition readout. The live surface carries its own readout
in the operator dock header, so this pill bows out entirely while liveMode
is on. Subscriptions stay primitive-only. */
export const CanvasStatusPill = memo(function CanvasStatusPill() {
  const liveMode = useCanvasStore((s) => s.liveMode);
  const linkCount = useCanvasStore((s) => s.connectionLines.length);
  const compositionKey = useCanvasStore((s) => {
    const counts: Partial<Record<ResourceCategory, number>> = {};
    for (const resource of s.resources) {
      const category = CATEGORY_OF_RESOURCE_TYPE[resource.type];
      counts[category] = (counts[category] ?? 0) + 1;
    }
    return CATEGORY_ORDER.map((entry) => counts[entry.category] ?? 0).join(":");
  });

  if (liveMode) return null;

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
      </span>
    </div>
  );
});