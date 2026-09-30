import { ResourceIcon } from "@/components/common/ResourceIcon";
import {
  categoryColorForType,
  categoryBadgeTint,
} from "@/theme/resourceCategoryHues";
import type { ResourceType } from "@shared/constants/RESOURCE_TYPES.constants";

interface CategoryIconBadgeProps {
  type: ResourceType;
}

/* Flat rounded-square category badge: 28x28, icon centered, background =
the category color at ~15% opacity, icon = the full category color. No
gradient, no glow, no shadow. The same map colors the resource sidebar and
the inspector, so one category reads as one color everywhere. */
export function CategoryIconBadge({ type }: CategoryIconBadgeProps) {
  const color = categoryColorForType(type);
  return (
    <span
      className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
      style={{ background: categoryBadgeTint(type), color }}
    >
      <ResourceIcon type={type} size={15} className="" />
    </span>
  );
}