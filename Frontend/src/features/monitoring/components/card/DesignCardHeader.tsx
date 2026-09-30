import { CategoryIconBadge } from "./CategoryIconBadge";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

interface DesignCardHeaderProps {
  type: ResourceType;
  displayName: string;
  titleText: string;
}

/* Design-state header: the node name leads in mono with a full-name hover
tooltip (truncation fix), and the flat category badge sits top-right. */
export function DesignCardHeader({ type, displayName, titleText }: DesignCardHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1.5">
      <span
        className="min-w-0 text-[13px] font-mono font-semibold text-[#EDEEF0] truncate"
        title={titleText}
      >
        {displayName}
      </span>
      <CategoryIconBadge type={type} />
    </div>
  );
}