import type { Resource } from "@shared/interface/Resource.interface";

export const CARD_LAYOUT_VERSION = 3;
const GRID_SIZE = 24;
// v2 (220x160 cards) -> v3 (264x200 cards) spacing factor.
const CARD_SCALE_STEP = 1.5;
// Pre-card 48px-era drafts first need the original 2x spread.
const LEGACY_STEP = 2;

/* Layouts store coordinates against whatever card size existed when they
   were saved. v3 draws 264x200 cards, so v2 layouts spread 1.5x and pre-card
   drafts spread 3x, both snapped back to the 24px grid. v3 layouts pass
   through untouched. */
export function migrateLayoutToCardScale(
  resources: Resource[],
  layoutVersion: number | undefined,
): Resource[] {
  if (layoutVersion !== undefined && layoutVersion >= CARD_LAYOUT_VERSION) {
    return resources;
  }
  const factor =
    layoutVersion === 2 ? CARD_SCALE_STEP : LEGACY_STEP * CARD_SCALE_STEP;
  return resources.map((resource) => ({
    ...resource,
    x: Math.round((resource.x * factor) / GRID_SIZE) * GRID_SIZE,
    y: Math.round((resource.y * factor) / GRID_SIZE) * GRID_SIZE,
  }));
}