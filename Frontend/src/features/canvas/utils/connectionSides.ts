import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";
import type { Resource } from "@shared/interface/Resource.interface";

export type ConnectionSide = "top" | "right" | "bottom" | "left";

/* Which edge of the `from` node a connection to `to` attaches to.
   Mirrors BezierConnectionLine's axis choice (center offsets cancel). */
export function connectionSide(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): ConnectionSide {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "right" : "left";
  }
  return dy >= 0 ? "bottom" : "top";
}

/* Comma-joined edges of `resourceId` that currently hold a connection end.
   Primitive string so the zustand selector re-renders only on real change. */
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