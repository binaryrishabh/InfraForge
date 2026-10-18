import type { ResourceType } from "@infraforge/domain/resource";
import { StationGlyph } from "@/ui/StationGlyph";

interface ResourceIconProps {
  type: ResourceType;
  size?: number;
  className?: string;
}

// The same station pictogram the maps and timetables use, so a resource looks the same everywhere.
export function ResourceIcon({ type, size = 20, className }: ResourceIconProps) {
  return <StationGlyph type={type} size={size} className={className ?? "text-ink-2"} />;
}
