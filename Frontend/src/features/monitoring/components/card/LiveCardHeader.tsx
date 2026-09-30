import type { ResourceHealthType } from "@shared/enum/ResourceHealth.enum";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";
import { healthChipStyles } from "./healthStyles";
import { CategoryIconBadge } from "./CategoryIconBadge";

interface LiveCardHeaderProps {
  type: ResourceType;
  displayName: string;
  titleText: string;
  health: ResourceHealthType;
}

/* Live-state header: mono name with full-name tooltip on the left; on the
right the flat semantic health chip keeps its slot and the category badge
takes the top-right corner of the card. */
export function LiveCardHeader({ type, displayName, titleText, health }: LiveCardHeaderProps) {
  const chipStyle = healthChipStyles[health];
  return (
    <div className="flex items-center justify-between gap-2 mb-1">
      <span
        className="min-w-0 text-[13px] font-mono font-semibold text-[#EDEEF0] truncate"
        title={titleText}
      >
        {displayName}
      </span>
      <div className="flex items-center gap-1.5 shrink-0">
        <span
          className={`flex items-center gap-1.5 text-[9px] font-mono uppercase font-semibold px-1.5 py-0.5 rounded border ${chipStyle.text} ${chipStyle.border}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${chipStyle.dotBg}`} />
          {health}
        </span>
        <CategoryIconBadge type={type} />
      </div>
    </div>
  );
}