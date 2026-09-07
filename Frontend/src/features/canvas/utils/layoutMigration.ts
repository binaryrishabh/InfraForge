import type { Resource } from "@shared/interface/Resource.interface";

export const CARD_LAYOUT_VERSION = 2;
const GRID_SIZE = 24;

/* Legacy 48px-era layouts stored dense coordinates. The unified canvas draws
   220x140 dashboard cards, so any layout without a version marker (or below
   CARD_LAYOUT_VERSION) is spread 2x and snapped to the 24px grid to avoid
   pile-ups. Layouts already at the card scale pass through untouched. */
export function migrateLayoutToCardScale(
  resources: Resource[],
  layoutVersion: number | undefined,
): Resource[] {
  if (layoutVersion !== undefined && layoutVersion >= CARD_LAYOUT_VERSION) {
    return resources;
  }
  return resources.map((resource) => ({
    ...resource,
    x: Math.round((resource.x * 2) / GRID_SIZE) * GRID_SIZE,
    y: Math.round((resource.y * 2) / GRID_SIZE) * GRID_SIZE,
  }));
}