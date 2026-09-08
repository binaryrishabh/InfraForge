import {
  NODE_CARD_WIDTH,
  NODE_CARD_HEIGHT,
} from "@/features/monitoring/components/MonitoringDashboardCard";

// Breathing room kept between cards so port rings and card shadows never
// collide. With 24px grid snap this still packs cards nearly edge-to-edge,
// so nodes no longer "invisibly" reserve extra space.
const CARD_PACK_GAP = 8;

/* True rectangle overlap for two card top-left anchors, inflated only by
   CARD_PACK_GAP. Replaces the old "card + 20" invisible box. */
export function cardsOverlap(
  aX: number,
  aY: number,
  bX: number,
  bY: number,
): boolean {
  return (
    Math.abs(aX - bX) < NODE_CARD_WIDTH + CARD_PACK_GAP &&
    Math.abs(aY - bY) < NODE_CARD_HEIGHT + CARD_PACK_GAP
  );
}

/* Whether a proposed top-left position collides with any existing card.
   ignoreId lets move checks exclude the card being moved. */
export function positionIsOccupied(
  resources: Array<{ id: string; x: number; y: number }>,
  x: number,
  y: number,
  ignoreId?: string,
): boolean {
  for (const resource of resources) {
    if (resource.id === ignoreId) continue;
    if (cardsOverlap(resource.x, resource.y, x, y)) return true;
  }
  return false;
}