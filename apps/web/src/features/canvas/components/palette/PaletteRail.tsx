import { PanelLeftOpen } from "lucide-react";
import { RESOURCE_TYPES, type ResourceType } from "@infraforge/domain/resource";
import { ResourceIcon } from "@/components/common/ResourceIcon";
import { IconButton } from "@/ui/IconButton";
import { categoryColor } from "@/theme/categories";
import { addResource } from "../../actions";

const TYPES = Object.values(RESOURCE_TYPES) as ResourceType[];

/* The collapsed palette: one button per resource type, placing it in view. */
export function PaletteRail({ onExpand }: { onExpand: () => void }) {
  return (
    <nav aria-label="Resources" className="flex h-full flex-col items-center gap-0.5 overflow-y-auto py-2">
      <IconButton label="Show the resource list" icon={<PanelLeftOpen size={16} />} onClick={onExpand} className="mb-1" />
      {TYPES.map((type) => (
        <IconButton key={type} label={`Add ${type}`} onClick={() => addResource(type)}
          icon={<span style={{ color: categoryColor(type) }} className="inline-flex"><ResourceIcon type={type} size={16} className="" /></span>} />
      ))}
    </nav>
  );
}
