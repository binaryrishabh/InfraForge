import { ResourceIcon } from "@/components/common/ResourceIcon";
import { hueTile } from "@/theme/resourceCategoryHues";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";
import type { ResourceHealthType } from "@shared/enum/ResourceHealth.enum";
import { healthChipStyles, healthColorHex } from "./healthStyles";

interface LiveCardHeaderProps {
  type: ResourceType;
  displayName: string;
  titleText: string;
  hue: string;
  health: ResourceHealthType;
}

/* Live-state header: small tile + name on the left, glowing health chip right.
Tile + glyph sized ~20% larger (28px/14px -> 32px/17px) to match the design
state's stronger identity read. */
export function LiveCardHeader({ type, displayName, titleText, hue, health }: LiveCardHeaderProps) {
  const chipStyle = healthChipStyles[health];
  const healthColor = healthColorHex[health];
  return (
    <div className="flex items-center justify-between mb-1">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
          style={{ background: hueTile(hue), color: hue }}
        >
          <ResourceIcon type={type} size={17} className="" />
        </span>
        <span
          className="text-[13px] font-mono font-semibold text-[#EDF1F7] truncate"
          title={titleText}
        >
          {displayName}
        </span>
      </div>
      <span
        className={`flex items-center gap-1 text-[9px] font-mono uppercase font-semibold px-1.5 py-0.5 rounded-full border ${chipStyle.text} ${chipStyle.border}`}
        style={{ background: `${healthColor}14` }}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${chipStyle.dotBg}`}
          style={{ boxShadow: `0 0 6px ${healthColor}, 0 0 12px ${healthColor}80` }}
        />
        {health}
      </span>
    </div>
  );
}