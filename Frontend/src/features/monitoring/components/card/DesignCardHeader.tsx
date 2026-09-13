import { ResourceIcon } from "@/components/common/ResourceIcon";
import { hueTile } from "@/theme/resourceCategoryHues";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

interface DesignCardHeaderProps {
  type: ResourceType;
  displayName: string;
  titleText: string;
  hue: string;
}

/* Design-state header: the name leads and the identity tile parks top-right.
Tile + glyph sized ~20% larger than the original 36px/18px pair so the node
identity reads at a glance; content still fits under the 120px footprint. */
export function DesignCardHeader({ type, displayName, titleText, hue }: DesignCardHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-2 mb-1.5">
      <span
        className="min-w-0 text-[13px] font-mono font-semibold text-[#EDF1F7] truncate"
        title={titleText}
      >
        {displayName}
      </span>
      <span
        className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: hueTile(hue), color: hue }}
      >
        <ResourceIcon type={type} size={22} className="" />
      </span>
    </div>
  );
}