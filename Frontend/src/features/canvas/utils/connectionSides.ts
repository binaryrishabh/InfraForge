import {
  NODE_CARD_WIDTH,
  NODE_CARD_HEIGHT,
} from "@/features/monitoring/components/MonitoringDashboardCard";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
import type { Resource } from "@shared/interface/Resource.interface";

export type ConnectionSide = "top" | "right" | "bottom" | "left";

/* Which edge of the `from` node a connection to `to` attaches to.
   Mirrors BezierConnectionLine's axis choice so sockets line up
   exactly with the line anchors. */
export function connectionSide(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): ConnectionSide {
  const cx1 = fromX + NODE_CARD_WIDTH / 2;
  const cy1 = fromY + NODE_CARD_HEIGHT / 2;
  const cx2 = toX + NODE_CARD_WIDTH / 2;
  const cy2 = toY + NODE_CARD_HEIGHT / 2;
  const dx = cx2 - cx1;
  const dy = cy2 - cy1;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "right" : "left";
  }
  return dy >= 0 ? "bottom" : "top";
}

/* Comma-joined edges of `resourceId` that currently hold a connection end.
   Returns a primitive string so the zustand selector only re-renders the
   node when its occupied-side set actually changes. */
export function occupiedSidesFor(
  resources: Resource[],
  connectionLines: ConnectionLine[],
  resourceId: string,
): string {
  const byId = new Map(resources.map((r) => [r.id, r]));
  const me = byId.get(resourceId);
  if (!me) return "";
  const sides = new Set<ConnectionSide>();
  for (const line of connectionLines) {
    if (line.sourceId === resourceId) {
      const other = byId.get(line.targetId);
      if (other) sides.add(connectionSide(me.x, me.y, other.x, other.y));
    } else if (line.targetId === resourceId) {
      const other = byId.get(line.sourceId);
      if (other) sides.add(connectionSide(me.x, me.y, other.x, other.y));
    }
  }
  return [...sides].sort().join(",");
}